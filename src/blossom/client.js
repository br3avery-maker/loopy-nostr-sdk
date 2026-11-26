import { endpoint } from '../core/urls.js';
import { bytes, sha256, toBase64Url, encode } from '../core/bytes.js';
import { isHex, assertSafeInt } from '../core/guards.js';
import { defaultFetch, boundedFetch, sdkError } from '../core/http.js';
import { eventTemplate, checkedSign, verifyEvent } from '../nostr/events.js';
import { mediaType } from '../nsite/files.js';

export function blossomAuthHeader(signedEvent) {
  if (!signedEvent || typeof signedEvent !== 'object') throw new TypeError('Signed Blossom auth event required');
  return 'Nostr ' + toBase64Url(encode(JSON.stringify(signedEvent)));
}

export function blossomUploadAuth({ hash, server, expiresIn = 600, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!isHex(hash, 64)) throw new TypeError('SHA-256 hash required');
  assertSafeInt(now, { min: 1, label: 'now' });
  assertSafeInt(expiresIn, { min: 1, max: 600, label: 'expiresIn' });
  return eventTemplate({
    kind: 24242,
    created_at: now,
    tags: [
      ['t', 'upload'],
      ['expiration', String(now + expiresIn)],
      ['server', new URL(endpoint(server, 'blossom')).hostname],
      ['x', hash],
    ],
    content: 'Upload nsite asset ' + hash.slice(0, 16),
  });
}

function validateUploadAuthEvent(authEvent, { hash, host, pubkey, now }) {
  if (!authEvent || typeof authEvent !== 'object' || !verifyEvent(authEvent)) {
    throw new Error('Invalid Blossom upload authorization');
  }
  if (authEvent.kind !== 24242) throw new Error('Invalid Blossom upload authorization');
  if (pubkey && authEvent.pubkey !== pubkey) throw new Error('Blossom upload authorization pubkey mismatch');
  const tags = Array.isArray(authEvent.tags) ? authEvent.tags : [];
  if (!tags.some(t => t[0] === 't' && t[1] === 'upload')) throw new Error('Invalid Blossom upload authorization');
  if (!tags.some(t => t[0] === 'x' && t[1] === hash)) throw new Error('Blossom upload authorization missing blob hash');
  const serverTags = tags.filter(t => t[0] === 'server').map(t => String(t[1] || '').toLowerCase().replace(/\.$/, ''));
  if (serverTags.length && !serverTags.includes(host)) {
    throw new Error('Blossom upload authorization missing server host');
  }
  const expTag = tags.find(t => t[0] === 'expiration')?.[1];
  if (expTag !== undefined) {
    const exp = Number(expTag);
    if (!Number.isSafeInteger(exp) || exp <= now) throw new Error('Blossom upload authorization expired');
  }
  return authEvent;
}

const JS_MEDIA_TYPES = ['text/javascript', 'application/javascript', 'application/x-javascript'];
const ICON_MEDIA_TYPES = ['image/x-icon', 'image/vnd.microsoft.icon'];

function baseMediaType(value) {
  return String(value ?? '').split(';')[0].trim().toLowerCase();
}

function readbackTypeMatches(expected, actualHeader) {
  const act = baseMediaType(actualHeader);
  return (
    act === expected ||
    (JS_MEDIA_TYPES.includes(expected) && JS_MEDIA_TYPES.includes(act)) ||
    (ICON_MEDIA_TYPES.includes(expected) && ICON_MEDIA_TYPES.includes(act))
  );
}

/** Real BUD-11 upload + descriptor + exact-byte readback; signer stays external. */
export async function uploadVerified(
  data,
  {
    server,
    signer,
    pubkey,
    authEvent,
    path = 'file',
    fetcher = defaultFetch,
    signal,
    clock,
    timeoutMs = 30000,
    expectedType,
    verifyContentType = false,
  } = {}
) {
  if (typeof fetcher !== 'function') throw new TypeError('fetch transport required');
  if (clock !== undefined && typeof clock !== 'function') throw new TypeError('clock must be a function');
  assertSafeInt(timeoutMs, { min: 1, max: 120000, label: 'timeoutMs' });
  const body = new Uint8Array(bytes(data));
  const hash = await sha256(body);
  const base = endpoint(server, 'blossom');
  const host = new URL(base).hostname;
  const now = clock ? clock() : Math.floor(Date.now() / 1000);
  const event = authEvent
    ? validateUploadAuthEvent(authEvent, { hash, host, pubkey, now })
    : await checkedSign(signer, blossomUploadAuth({ hash, server: base, now }), pubkey);
  const uploadContentType = expectedType ? String(expectedType) : mediaType(path);

  const response = await boundedFetch(
    base + '/upload',
    {
      method: 'PUT',
      headers: {
        Authorization: blossomAuthHeader(event),
        'Content-Type': uploadContentType,
        'X-SHA-256': hash,
      },
      body,
    },
    { fetcher, signal, timeoutMs, maxBytes: 65536, read: 'json' }
  );
  if (!response.ok) {
    throw sdkError('Blossom upload HTTP ' + response.status, {
      code: 'http',
      status: response.status,
      server: base,
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  const descriptor = response.json;
  if (!descriptor || typeof descriptor !== 'object' || descriptor.sha256 !== hash || descriptor.size !== body.length) {
    throw sdkError('Blossom descriptor mismatch', { code: 'descriptor-mismatch', server: base, retryable: false });
  }
  const remote = await boundedFetch(base + '/' + hash, {}, { fetcher, signal, timeoutMs, maxBytes: body.length, read: 'bytes' });
  if (!remote.ok || !remote.data || remote.data.byteLength !== body.length || (await sha256(remote.data)) !== hash) {
    throw sdkError('Blossom download integrity mismatch', { code: 'integrity', server: base, retryable: false });
  }
  const expectedBase = baseMediaType(uploadContentType);
  if (verifyContentType) {
    const actualHeader = remote.headers?.get?.('content-type');
    if (!readbackTypeMatches(expectedBase, actualHeader)) {
      throw sdkError('Blossom download content type mismatch', { code: 'mime-mismatch', server: base, retryable: false });
    }
    return {
      hash,
      size: body.length,
      server: base,
      verified: true,
      url: base + '/' + hash,
      typeVerified: true,
      type: expectedBase,
    };
  }
  return { hash, size: body.length, server: base, verified: true, url: base + '/' + hash };
}

/** Bounded fallback across public HTTPS endpoints; verify all returned bytes. */
export async function fetchVerified(
  hash,
  { servers = [], fetcher = defaultFetch, signal, timeoutMs = 15000, maxBytes = 128 * 1024 * 1024 } = {}
) {
  if (!isHex(hash, 64)) throw new TypeError('Hash required');
  if (!Array.isArray(servers) || servers.length > 32) throw new RangeError('Maximum 32 Blossom endpoints');
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > 512 * 1024 * 1024
  ) {
    throw new RangeError('Invalid Blossom retrieval limits');
  }
  if (typeof fetcher !== 'function') throw new TypeError('Fetch transport required');
  const failures = [];
  const seen = new Set();
  for (const input of servers) {
    if (signal?.aborted) throw sdkError('Blossom retrieval cancelled', { code: 'cancelled', retryable: false });
    let server = String(input);
    try {
      server = endpoint(input, 'blossom');
      if (seen.has(server)) continue;
      seen.add(server);
      const result = await boundedFetch(server + '/' + hash, {}, { fetcher, signal, timeoutMs, maxBytes, read: 'bytes' });
      if (!result.ok) {
        throw sdkError('HTTP ' + result.status, { code: 'http', status: result.status, server });
      }
      if ((await sha256(result.data)) !== hash) {
        throw sdkError('Content hash mismatch', { code: 'integrity', server });
      }
      if (signal?.aborted) throw sdkError('Blossom retrieval cancelled', { code: 'cancelled', retryable: false });
      return { server, data: result.data, hash, failed: failures.map(e => ({ error: e.message })) };
    } catch (e) {
      if (signal?.aborted || e?.code === 'cancelled') {
        throw sdkError('Blossom retrieval cancelled', { code: 'cancelled', retryable: false, cause: e });
      }
      failures.push(new Error(`${server}: ${e?.message ?? e}`));
    }
  }
  if (signal?.aborted) throw sdkError('Blossom retrieval cancelled', { code: 'cancelled', retryable: false });
  throw new AggregateError(failures, 'No Blossom copy passed SHA-256');
}
