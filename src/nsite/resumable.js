import { parseManifest } from './manifest.js';
import { defaultFetch, boundedFetch } from '../core/http.js';
import { mapLimit } from '../core/concurrency.js';
import { assertSafeInt } from '../core/guards.js';
import { contentTypeMatches } from '../core/media.js';
import { checkedSign } from '../nostr/events.js';
import { verifiedCopy, eventIdentity } from '../nostr/history.js';
import { verifiedReceipts } from '../nostr/receipts.js';
import { verifyBlobCopies, preflightBlob, blossomBatchUploadAuth } from '../blossom/replicas.js';
import { fetchVerified, uploadVerified } from '../blossom/client.js';

const matchesTemplate = (event, plan) =>
  event.pubkey === plan.pubkey &&
  event.kind === plan.template.kind &&
  event.created_at === plan.template.created_at &&
  event.content === plan.template.content &&
  JSON.stringify(event.tags) === JSON.stringify(plan.template.tags);
const cancelled = signal => {
  if (signal?.aborted) throw new Error('Publication cancelled');
};


function uploadFailureCode(err) {
  if (err?.code && typeof err.code === 'string') return err.code;
  const msg = String(err?.message ?? '');
  if (/timed out/i.test(msg)) return 'timeout';
  if (/HTTP \d{3}\b/.test(msg)) return 'http';
  if (/descriptor/i.test(msg)) return 'descriptor-mismatch';
  if (/integrity|hash/i.test(msg)) return 'integrity';
  if (/Unverified upload/i.test(msg)) return 'unverified';
  return 'upload-failed';
}

/** Bound the existing uploader's descriptor and body read via Core.boundedFetch without changing its signing contract. */
function scopedUploadFetch(fetcher, server, entry, signal) {
  return async (url, init = {}) => {
    const isPut = url === server + '/upload' && init.method === 'PUT';
    if (!isPut && !(url === server + '/' + entry.hash && (!init.method || init.method === 'GET'))) {
      throw new Error('Unexpected upload transport destination');
    }
    cancelled(signal);
    const maxBytes = isPut ? 65536 : entry.size;
    const res = await boundedFetch(url, init, { fetcher, signal, timeoutMs: 45000, maxBytes, read: 'bytes' });
    if (!res.ok) return { ok: false, status: res.status };
    const data = res.data;
    return {
      ok: true,
      status: res.status,
      headers: res.headers,
      json: async () => JSON.parse(new TextDecoder().decode(data)),
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  };
}

/** Verify exact gateway paths with the SDK's existing bounded hash-verifying reader. */
async function checkGateway(plan, fetcher, signal, { timeoutMs = 30000, concurrency = 4, onProgress } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  const base = new URL(plan.gateway);
  let completed = 0;
  try {
    const files = await mapLimit(
      plan.files,
      concurrency,
      async entry => {
        cancelled(signal);
        if (controller.signal.aborted) {
          completed += 1;
          onProgress?.({ stage: 'gateway', path: entry.path, hash: entry.hash, completed, total: plan.files.length });
          return { path: entry.path, status: 'unverified' };
        }
        // Encode every segment; a literal '%' or space in a file name cannot redirect the request.
        const url = new URL(entry.path.split('/').map(encodeURIComponent).join('/'), base).href;
        let row;
        try {
          const r = await fetchVerified(entry.hash, {
            servers: [base.origin],
            maxBytes: entry.size,
            timeoutMs: Math.min(10000, timeoutMs),
            signal: controller.signal,
            fetcher: async (_hashURL, init) => {
              const response = await fetcher(url, { ...init, redirect: 'error', credentials: 'omit', cache: 'no-store' });
              if (response.redirected || !response.ok || !contentTypeMatches(entry.type, response.headers?.get?.('content-type'))) {
                throw new Error('Gateway response or MIME mismatch');
              }
              return response;
            },
          });
          if (r.data.byteLength !== entry.size) throw new Error('Gateway size mismatch');
          row = { path: entry.path, status: 'hash-verified' };
        } catch {
          cancelled(signal);
          row = { path: entry.path, status: 'unverified' };
        }
        completed += 1;
        onProgress?.({ stage: 'gateway', path: entry.path, hash: entry.hash, completed, total: plan.files.length });
        return row;
      },
      { signal }
    );
    return {
      url: plan.gateway,
      status: files.every(f => f.status === 'hash-verified') ? 'verified' : 'unverified',
      files,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}

/** Version 2 orchestration, reached through the existing publishNsite API. */
export async function publishResumable(
  prepared,
  plan,
  {
    signer,
    allowFileRemovals,
    resolveCurrent,
    uploader,
    publisher,
    checkpoint,
    signal,
    Socket,
    fetcher = defaultFetch,
    clock,
    timeoutMs,
    authSigner,
    authPubkey,
    requireAuthentication,
    resume,
    preflight = false,
    batchAuth = false,
    gatewayTimeoutMs = 30000,
    gatewayConcurrency = 4,
    onProgress,
  } = {}
) {
  cancelled(signal);
  if (typeof resolveCurrent !== 'function') throw new Error('Replica publication requires a current-revision resolver');
  if (typeof signer.getPublicKey !== 'function' || typeof fetcher !== 'function') {
    throw new TypeError('Replica publication requires an account check and fetch transport');
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') {
    throw new TypeError('onProgress must be a function');
  }
  assertSafeInt(gatewayTimeoutMs, { min: 1, max: 300000, label: 'gatewayTimeoutMs' });
  assertSafeInt(gatewayConcurrency, { min: 1, max: 16, label: 'gatewayConcurrency' });
  const emitProgress = info => {
    if (onProgress) onProgress(info);
  };
  if (plan.changes.some(c => c.change === 'deleted') && allowFileRemovals !== true) {
    throw new Error('Publication removes files; explicit removal approval required');
  }
  let event = null;
  // Saved claims of uploads or relay delivery are never accepted as fresh evidence.
  if (resume !== undefined) {
    if (!resume || resume.schema !== 'nsite-job/2' || resume.planId !== plan.id || resume.baselineId !== plan.baselineId || resume.aggregate !== plan.aggregate) {
      throw new Error('Resume checkpoint does not match approved publication plan');
    }
    if (resume.event !== undefined && resume.event !== null) {
      event = verifiedCopy(resume.event);
      if (!matchesTemplate(event, plan)) throw new Error('Resume manifest differs from approved publication plan');
    }
    if (resume.eventId != null && resume.eventId !== event?.id) throw new Error('Resume event ID mismatch');
  }
  const job = {
    schema: 'nsite-job/2',
    identifier: plan.identifier,
    aggregate: plan.aggregate,
    planId: plan.id,
    baselineId: plan.baselineId,
    files: [],
    relays: [],
    stage: 'prepared',
    event,
    eventId: event?.id ?? null,
    gateway: null,
  };
  const save = async () => {
    await checkpoint(structuredClone(job));
    cancelled(signal);
  };
  const identity = async () => {
    cancelled(signal);
    if ((await signer.getPublicKey()) !== plan.pubkey) throw new Error('Signer account does not match publication');
    cancelled(signal);
  };
  const checkCurrent = async () => {
    await identity();
    const current = await resolveCurrent({ pubkey: plan.pubkey, kind: plan.template.kind, identifier: plan.identifier, relays: [...plan.relays], signal });
    await identity();
    if (current === null) {
      if (plan.baselineId !== null) throw new Error('Publication baseline missing; prepare a new preview');
      return;
    }
    const observed = verifiedCopy(current);
    if (
      eventIdentity(observed) !== `${plan.template.kind}:${plan.pubkey}:${plan.identifier}` ||
      !(observed.id === plan.baselineId || observed.id === event?.id)
    ) {
      throw new Error('Publication baseline changed; prepare a new preview');
    }
  };
  const publishOptions = {
    signal,
    Socket,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(authSigner !== undefined ? { authSigner } : {}),
    ...(authPubkey !== undefined ? { authPubkey } : {}),
    ...(requireAuthentication !== undefined ? { requireAuthentication } : {}),
  };
  // A new or resumed job must observe the approved baseline or the exact saved signed revision.
  await checkCurrent();
  await save();
  emitProgress({ stage: 'prepared', completed: 0, total: prepared.entries.length });
  try {
    const types = new Map(plan.files.map(f => [f.path, f.type]));
    const uniqueHashes = [...new Set(prepared.entries.map(e => e.hash))];
    // Lazily signed per-server BUD-11 batch auth cache (≤24 hashes per token) when batchAuth === true.
    const batchAuthCache = new Map();
    const getBatchAuth = async (server, hash) => {
      if (!batchAuth) return undefined;
      let serverMap = batchAuthCache.get(server);
      if (!serverMap) {
        serverMap = new Map();
        batchAuthCache.set(server, serverMap);
      }
      if (serverMap.has(hash)) return serverMap.get(hash);
      const remaining = uniqueHashes.filter(h => !serverMap.has(h));
      const chunk = remaining.includes(hash) ? remaining.slice(0, 24) : [hash];
      if (!chunk.includes(hash)) chunk[chunk.length - 1] = hash;
      const now = clock ? clock() : Math.floor(Date.now() / 1000);
      const authTemplate = blossomBatchUploadAuth({ hashes: chunk, servers: [server], now });
      const signedAuth = await checkedSign(signer, authTemplate, plan.pubkey);
      for (const h of chunk) serverMap.set(h, signedAuth);
      return signedAuth;
    };

    // Deduplicate verification and uploads across paths sharing identical SHA-256 + MIME type.
    const verifiedBlobs = new Map();
    for (const entry of prepared.entries) {
      await identity();
      const metadata = { sha256: entry.hash, size: entry.size, type: types.get(entry.path) };
      const blobKey = `${entry.hash}:${metadata.type}`;
      if (verifiedBlobs.has(blobKey)) {
        const cached = verifiedBlobs.get(blobKey);
        const row = {
          path: entry.path,
          hash: entry.hash,
          size: entry.size,
          type: metadata.type,
          copies: structuredClone(cached.copies),
          attempts: structuredClone(cached.attempts),
        };
        job.files.push(row);
        job.stage = 'uploading';
        await save();
        emitProgress({
          stage: 'uploading',
          path: entry.path,
          hash: entry.hash,
          deduplicated: true,
          completed: job.files.length,
          total: prepared.entries.length,
        });
        continue;
      }
      const check = (servers, required = 1, earlyStop = false) =>
        verifyBlobCopies(metadata, { servers, required, fetcher, signal, earlyStop });
      const prior = await check([...plan.storage.servers], plan.storage.required, true);
      const copies = new Map(prior.copies.map(c => [new URL(c.server).origin, c]));
      const row = { path: entry.path, hash: entry.hash, size: entry.size, type: metadata.type, copies: [...copies.values()], attempts: [] };
      job.files.push(row);
      job.stage = 'uploading';
      await save();
      let candidateServers = [...plan.storage.servers];
      if (preflight && copies.size < plan.storage.required) {
        const remaining = candidateServers.filter(s => !copies.has(new URL(s).origin));
        if (remaining.length) {
          const pf = await preflightBlob(metadata, { servers: remaining, fetcher, signal });
          const ordered = [...pf.selected, ...pf.fallbacks];
          candidateServers = ordered.length ? ordered : remaining;
        }
      }
      for (const server of candidateServers) {
        if (copies.size >= plan.storage.required) break;
        const origin = new URL(server).origin;
        if (copies.has(origin)) continue;
        await identity();
        try {
          const authEvent = await getBatchAuth(server, entry.hash);
          const result = await uploader(new Uint8Array(entry.bytes), {
            server,
            signer,
            pubkey: plan.pubkey,
            ...(authEvent ? { authEvent } : {}),
            path: entry.path,
            expectedType: metadata.type,
            verifyContentType: true,
            signal,
            clock,
            fetcher: scopedUploadFetch(fetcher, server, entry, signal),
          });
          if (!result?.verified || result.hash !== entry.hash) throw new Error('Unverified upload');
          await identity();
          if (
            uploader === uploadVerified &&
            result.typeVerified === true &&
            result.size === entry.size &&
            result.server === server
          ) {
            copies.set(origin, {
              server,
              hash: entry.hash,
              size: entry.size,
              type: metadata.type,
              verified: true,
            });
            row.attempts.push({ server, status: 'hash-verified' });
          } else {
            const observed = await check([server]);
            for (const copy of observed.copies) copies.set(new URL(copy.server).origin, copy);
            row.attempts.push({ server, status: observed.copies.length ? 'hash-verified' : 'unverified' });
          }
        } catch (err) {
          cancelled(signal);
          await identity();
          row.attempts.push({ server, status: 'failed', code: uploadFailureCode(err) });
        }
        row.copies = [...copies.values()];
        await save();
      }
      if (copies.size < plan.storage.required) throw new Error('Insufficient independently verified storage copies: ' + entry.path);
      verifiedBlobs.set(blobKey, { copies: row.copies, attempts: row.attempts });
      emitProgress({
        stage: 'uploading',
        path: entry.path,
        hash: entry.hash,
        deduplicated: false,
        completed: job.files.length,
        total: prepared.entries.length,
      });
    }
    await checkCurrent();
    if (!event) {
      event = verifiedCopy(await checkedSign(signer, plan.template, plan.pubkey));
      await identity();
    }
    const manifest = await parseManifest(event, clock ? { now: clock() } : undefined);
    job.stage = 'signed';
    job.event = event;
    job.eventId = event.id;
    await save();
    emitProgress({ stage: 'signed', completed: 1, total: 1 });
    await checkCurrent();
    const receipts = await publisher(structuredClone(event), [...plan.relays], publishOptions);
    job.relays = verifiedReceipts(receipts, event.id, plan.relays);
    if (!job.relays.length) throw new Error('No signed nsite manifest was independently read back');
    job.url = plan.gateway ?? manifest.url;
    job.stage = 'relay-verified';
    await save();
    emitProgress({ stage: 'relay-verified', completed: job.relays.length, total: plan.relays.length });
    if (plan.gateway) {
      await identity();
      job.gateway = await checkGateway(plan, fetcher, signal, {
        timeoutMs: gatewayTimeoutMs,
        concurrency: gatewayConcurrency,
        onProgress: emitProgress,
      });
      job.stage = job.gateway.status === 'verified' ? 'site-verified' : 'gateway-unverified';
      await save();
    }
    return { job, event, manifest, receipts: { ...receipts, verified: job.relays } };
  } catch (error) {
    // Preserve a recoverable, sanitized last checkpoint on errors; no auth tokens or bytes.
    const failure = new Error(String(error?.message ?? error), { cause: error });
    failure.job = structuredClone(job);
    throw failure;
  }
}

