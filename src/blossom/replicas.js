import { endpoint } from '../core/urls.js';
import { isHex, assertSafeInt } from '../core/guards.js';
import { defaultFetch, boundedFetch, sdkError } from '../core/http.js';
import { mapLimit } from '../core/concurrency.js';
import { contentTypeMatches } from '../core/media.js';
import { eventTemplate } from '../nostr/events.js';
import { fetchVerified } from './client.js';

const mime = value =>
  typeof value === 'string' && value.length <= 256 && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(value);

function blobMeta(blob) {
  if (!blob || !isHex(blob.sha256, 64) || !Number.isSafeInteger(blob.size) || blob.size < 0 || !mime(blob.type)) {
    throw new TypeError('Invalid blob metadata');
  }
  return { sha256: blob.sha256, size: blob.size, type: blob.type.toLowerCase() };
}

export function normalizeBlobServers(servers) {
  if (!Array.isArray(servers) || !servers.length || servers.length > 16) {
    throw new RangeError('Supply 1–16 explicit Blossom destinations');
  }
  return [
    ...new Set(
      servers.map(value => {
        if (typeof value !== 'string' || value.length > 2048) throw new TypeError('Invalid Blossom destination');
        // Delegate public named HTTPS canonicalization to Core.endpoint so host rules stay single-sourced.
        return endpoint(value, 'blossom', { publicHost: true });
      })
    ),
  ];
}

function checkOptions(fetcher, timeoutMs) {
  if (typeof fetcher !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new TypeError('Invalid fetch transport or timeout');
  }
}

function cancelled(signal) {
  if (signal?.aborted) throw sdkError('Blossom operation cancelled', { code: 'cancelled', retryable: false });
}

const codes = {
  200: 'preflight-accepted',
  400: 'invalid',
  401: 'auth-required',
  402: 'payment-required',
  403: 'policy',
  404: 'preflight-unsupported',
  405: 'preflight-unsupported',
  411: 'length-required',
  413: 'size',
  415: 'media-type',
  429: 'rate-limited',
  501: 'preflight-unsupported',
  503: 'unavailable',
};

/** BUD-06 metadata-only check. No upload, auth token, payment or existence claim. */
export async function preflightBlob(blob, { servers, fetcher = defaultFetch, signal, timeoutMs = 10000 } = {}) {
  const metadata = blobMeta(blob);
  const destinations = normalizeBlobServers(servers);
  checkOptions(fetcher, timeoutMs);
  const decisions = [];
  for (const server of destinations) {
    cancelled(signal);
    try {
      const response = await boundedFetch(
        server + '/upload',
        {
          method: 'HEAD',
          headers: {
            'X-SHA-256': metadata.sha256,
            'X-Content-Length': String(metadata.size),
            'X-Content-Type': metadata.type,
          },
        },
        { fetcher, timeoutMs, signal, read: 'none' }
      );
      cancelled(signal);
      const status = response.status;
      decisions.push({
        server,
        status: Number.isInteger(status) ? status : null,
        code: codes[status] ?? 'unknown',
        verified: false,
      });
    } catch (e) {
      cancelled(signal);
      if (e?.code === 'cancelled') throw sdkError('Blossom operation cancelled', { code: 'cancelled', cause: e });
      decisions.push({ server, status: null, code: 'network', verified: false });
    }
  }
  return {
    ...metadata,
    decisions,
    selected: decisions.filter(d => d.code === 'preflight-accepted').map(d => d.server),
    fallbacks: decisions.filter(d => ['preflight-unsupported', 'unknown'].includes(d.code)).map(d => d.server),
  };
}

/** Prepare a bounded, explicitly scoped BUD-11 upload authorization for external signing. */
export function blossomBatchUploadAuth({ hashes, servers, now = Math.floor(Date.now() / 1000), expiresIn = 600 } = {}) {
  if (!Array.isArray(hashes) || !hashes.length || hashes.length > 24 || hashes.some(h => !isHex(h, 64))) {
    throw new TypeError('Supply 1–24 SHA-256 hashes');
  }
  assertSafeInt(now, { min: 1, label: 'now' });
  assertSafeInt(expiresIn, { min: 1, max: 600, label: 'expiresIn' });
  if (!Number.isSafeInteger(now + expiresIn)) throw new RangeError('Invalid authorization lifetime');
  const domains = [...new Set(normalizeBlobServers(servers).map(s => new URL(s).hostname.toLowerCase()))];
  const unique = [...new Set(hashes)];
  return eventTemplate({
    kind: 24242,
    created_at: now - 1,
    content: `Authorize upload of ${unique.length} blob(s) to ${domains.length} server domain(s)`,
    tags: [
      ['t', 'upload'],
      ['expiration', String(now + expiresIn)],
      ...unique.map(h => ['x', h]),
      ...domains.map(h => ['server', h]),
    ],
  });
}



function classifyCopyFailure(err, capturedCode) {
  if (capturedCode) return capturedCode;
  if (err?.code && typeof err.code === 'string' && err.code !== 'cancelled') {
    if (err.code === 'integrity') return 'hash-mismatch';
    return err.code;
  }
  const msg = String(err?.errors?.[0]?.message ?? err?.message ?? '');
  if (/timed out/i.test(msg)) return 'timeout';
  if (/byte limit|exceeds/i.test(msg)) return 'size-limit';
  if (/redirect/i.test(msg)) return 'redirect';
  if (/hash mismatch/i.test(msg)) return 'hash-mismatch';
  if (/byte count mismatch/i.test(msg)) return 'size-mismatch';
  if (/HTTP 404\b/.test(msg)) return 'not-found';
  if (/HTTP \d{3}\b/.test(msg)) return 'http-error';
  if (/network|fetch failed|ECONN|ENOTFOUND/i.test(msg)) return 'network';
  return 'readback-unverified';
}

/** Count actual readbacks, not uploader claims. Distinct origins, not proof of independent operators. */
export async function verifyBlobCopies(
  blob,
  {
    servers,
    required = 1,
    fetcher = defaultFetch,
    signal,
    timeoutMs = 15000,
    maxBytes = 128 * 1024 * 1024,
    earlyStop = false,
    concurrency = 1,
  } = {}
) {
  const metadata = blobMeta(blob);
  const destinations = normalizeBlobServers(servers);
  checkOptions(fetcher, timeoutMs);
  if (
    !Number.isSafeInteger(required) ||
    required < 1 ||
    required > 16 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    metadata.size > maxBytes ||
    maxBytes > 128 * 1024 * 1024 ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 16
  ) {
    throw new RangeError('Invalid copy count, concurrency, or byte bound');
  }
  // Deduplicate by origin up front so sequential and concurrent runs evaluate the same unique targets.
  const uniqueTargets = [];
  const seenOrigins = new Set();
  for (const server of destinations) {
    const origin = new URL(server).origin;
    if (seenOrigins.has(origin)) continue;
    seenOrigins.add(origin);
    uniqueTargets.push(server);
  }

  const checkOne = async (server, effectiveSignal) => {
    let capturedCode = null;
    try {
      const r = await fetchVerified(metadata.sha256, {
        servers: [server],
        signal: effectiveSignal,
        timeoutMs,
        maxBytes: metadata.size,
        fetcher: async (url, init) => {
          const response = await fetcher(url, { ...init, credentials: 'omit', cache: 'no-store' });
          if (!response) {
            capturedCode = 'network';
            throw sdkError('Empty blob response', { code: 'network', server });
          }
          if (response.redirected) {
            capturedCode = 'redirect';
            throw sdkError('Redirected blob response', { code: 'redirect', server });
          }
          if (!response.ok) {
            capturedCode = response.status === 404 ? 'not-found' : 'http-error';
            throw sdkError('HTTP ' + response.status, { code: capturedCode, status: response.status, server });
          }
          if (!contentTypeMatches(metadata.type, response.headers?.get?.('content-type'))) {
            capturedCode = 'mime-mismatch';
            throw sdkError('Unexpected blob content type', { code: 'mime-mismatch', server });
          }
          return response;
        },
      });
      cancelled(signal);
      if (r.server !== server || r.data.byteLength !== metadata.size) {
        capturedCode = 'size-mismatch';
        throw sdkError('Blob byte count mismatch', { code: 'size-mismatch', server });
      }
      return { ok: true, copy: { server, hash: metadata.sha256, size: metadata.size, type: metadata.type, verified: true } };
    } catch (e) {
      cancelled(signal);
      if (e?.code === 'cancelled' && signal?.aborted) {
        throw sdkError('Blossom operation cancelled', { code: 'cancelled', cause: e });
      }
      if (e?.code === 'cancelled' && effectiveSignal?.aborted && !signal?.aborted) {
        return { ok: false, skipped: true };
      }
      return { ok: false, failure: { server, code: classifyCopyFailure(e, capturedCode) } };
    }
  };

  const copies = [];
  const failed = [];
  if (concurrency === 1) {
    for (const server of uniqueTargets) {
      if (earlyStop && copies.length >= required) break;
      cancelled(signal);
      const outcome = await checkOne(server, signal);
      if (outcome.ok) copies.push(outcome.copy);
      else if (!outcome.skipped) failed.push(outcome.failure);
    }
  } else {
    const localController = earlyStop ? new AbortController() : null;
    const onOuterAbort = () => localController?.abort();
    if (localController && signal) {
      if (signal.aborted) localController.abort();
      else signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    const effectiveSignal = localController ? localController.signal : signal;
    let verifiedCount = 0;
    try {
      const outcomes = await mapLimit(
        uniqueTargets,
        concurrency,
        async server => {
          cancelled(signal);
          if (earlyStop && verifiedCount >= required) return { ok: false, skipped: true };
          const outcome = await checkOne(server, effectiveSignal);
          if (outcome.ok) {
            verifiedCount += 1;
            if (earlyStop && verifiedCount >= required) localController?.abort();
          }
          return outcome;
        },
        { signal }
      );
      for (const outcome of outcomes) {
        if (!outcome || outcome.skipped) continue;
        if (outcome.ok) copies.push(outcome.copy);
        else failed.push(outcome.failure);
      }
    } finally {
      if (localController && signal) signal.removeEventListener('abort', onOuterAbort);
    }
  }
  return {
    ...metadata,
    required,
    copies,
    failed,
    status: copies.length >= required ? 'verified' : copies.length ? 'partial' : 'unverified',
  };
}

