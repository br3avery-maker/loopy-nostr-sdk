import { isHex, assertSafeInt } from '../core/guards.js';
import { defaultFetch, sdkError } from '../core/http.js';
import { mediaType } from '../core/media.js';
import { fetchVerified, uploadVerified } from './client.js';
import { normalizeBlobServers, preflightBlob, verifyBlobCopies } from './replicas.js';

function collectManifestHashes(manifest, into) {
  if (!manifest || typeof manifest !== 'object') return;
  if (Array.isArray(manifest.files)) {
    for (const file of manifest.files) {
      const h = file?.hash ?? file?.sha256;
      if (isHex(h, 64)) into.add(h);
    }
  }
  if (Array.isArray(manifest.hashes)) {
    for (const h of manifest.hashes) {
      if (isHex(h, 64)) into.add(h);
    }
  }
  if (Array.isArray(manifest.tags)) {
    for (const tag of manifest.tags) {
      if (Array.isArray(tag) && tag[0] === 'path' && isHex(tag[2], 64)) into.add(tag[2]);
    }
  }
}

/**
 * Pure stateless orphan finder: returns sorted SHA-256 hashes from storedHashes that are
 * not referenced by any retained nsite manifest (parsed manifest, raw event, or { hashes }).
 */
export function findUnreferencedBlobs(storedHashes, retainedManifests = []) {
  if (!storedHashes || typeof storedHashes[Symbol.iterator] !== 'function') {
    throw new TypeError('storedHashes must be an iterable of SHA-256 hashes');
  }
  if (!retainedManifests || typeof retainedManifests[Symbol.iterator] !== 'function') {
    throw new TypeError('retainedManifests must be an iterable');
  }
  const retained = new Set();
  for (const manifest of retainedManifests) collectManifestHashes(manifest, retained);
  const unreferenced = new Set();
  for (const hash of storedHashes) {
    if (!isHex(hash, 64)) throw new TypeError('Invalid SHA-256 hash in storedHashes');
    if (!retained.has(hash)) unreferenced.add(hash);
  }
  return [...unreferenced].sort();
}

function extractManifestEntries(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new TypeError('Manifest object required');
  const raw = [];
  if (Array.isArray(manifest.files)) {
    for (const f of manifest.files) {
      const hash = f?.hash ?? f?.sha256;
      const path = typeof f?.path === 'string' && f.path ? f.path : `/${hash}`;
      if (!isHex(hash, 64)) throw new TypeError('Manifest file entry missing valid SHA-256 hash');
      raw.push({
        path,
        hash,
        size: Number.isSafeInteger(f?.size) && f.size >= 0 ? f.size : null,
        type: typeof f?.type === 'string' && f.type ? f.type.split(';')[0].trim().toLowerCase() : mediaType(path).split(';')[0],
      });
    }
  } else if (Array.isArray(manifest.tags)) {
    for (const tag of manifest.tags) {
      if (Array.isArray(tag) && tag[0] === 'path' && typeof tag[1] === 'string' && isHex(tag[2], 64)) {
        raw.push({
          path: tag[1],
          hash: tag[2],
          size: null,
          type: mediaType(tag[1]).split(';')[0],
        });
      }
    }
  } else {
    throw new TypeError('Manifest must provide a files array or signed path tags');
  }
  // Deduplicate by SHA-256 so shared blobs are verified and repaired once.
  const dedup = new Map();
  for (const entry of raw) {
    if (!dedup.has(entry.hash)) dedup.set(entry.hash, entry);
  }
  return [...dedup.values()];
}

function manifestServers(manifest) {
  if (Array.isArray(manifest?.servers) && manifest.servers.length) return manifest.servers;
  if (Array.isArray(manifest?.tags)) {
    return manifest.tags.filter(t => Array.isArray(t) && t[0] === 'server' && typeof t[1] === 'string').map(t => t[1]);
  }
  return [];
}

/**
 * Heal degraded Blossom blob replicas across targetServers by composing verifyBlobCopies,
 * fetchVerified, optional BUD-06 preflightBlob, and uploadVerified.
 */
export async function repairBlobReplicas(
  manifest,
  {
    sourceServers,
    targetServers,
    signer,
    pubkey,
    requiredCopies = 2,
    fetcher = defaultFetch,
    uploader = uploadVerified,
    signal,
    clock,
    timeoutMs = 15000,
    preflight = true,
    onProgress,
  } = {}
) {
  const entries = extractManifestEntries(manifest);
  const targets = normalizeBlobServers(targetServers);
  const uniqueOrigins = new Set(targets.map(s => new URL(s).origin)).size;
  assertSafeInt(requiredCopies, { min: 1, max: uniqueOrigins, label: 'requiredCopies' });
  assertSafeInt(timeoutMs, { min: 1, max: 120000, label: 'timeoutMs' });
  if (!signer || typeof signer.signEvent !== 'function' || !isHex(pubkey, 64)) {
    throw new TypeError('Approved signer and author pubkey required for replica repair');
  }
  if (typeof fetcher !== 'function' || typeof uploader !== 'function') {
    throw new TypeError('fetcher and uploader must be functions');
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') {
    throw new TypeError('onProgress must be a function');
  }

  const rawSources = sourceServers ?? [...manifestServers(manifest), ...targets];
  const sources = normalizeBlobServers(rawSources.length ? rawSources : targets);

  const blobs = [];
  let healthy = 0;
  let repaired = 0;
  let degraded = 0;

  for (let i = 0; i < entries.length; i++) {
    if (signal?.aborted) throw sdkError('Replica repair cancelled', { code: 'cancelled', retryable: false });
    const entry = entries[i];
    let fetched = null;
    let size = entry.size;

    if (size === null) {
      try {
        fetched = await fetchVerified(entry.hash, { servers: sources, fetcher, signal, timeoutMs });
        size = fetched.data.byteLength;
      } catch (err) {
        if (err?.code === 'cancelled' || signal?.aborted) {
          throw sdkError('Replica repair cancelled', { code: 'cancelled', retryable: false, cause: err });
        }
        degraded += 1;
        const row = {
          hash: entry.hash,
          path: entry.path,
          size: null,
          type: entry.type,
          status: 'degraded',
          beforeCopies: [],
          afterCopies: [],
          uploadedTo: [],
          failed: [{ stage: 'source-fetch', error: err?.message || String(err) }],
        };
        blobs.push(row);
        onProgress?.({ hash: entry.hash, path: entry.path, status: row.status, completed: i + 1, total: entries.length });
        continue;
      }
    }

    const metadata = { sha256: entry.hash, size, type: entry.type };
    const initial = await verifyBlobCopies(metadata, {
      servers: targets,
      required: requiredCopies,
      fetcher,
      signal,
      timeoutMs,
      earlyStop: false,
    });
    const copies = new Map(initial.copies.map(c => [new URL(c.server).origin, c]));
    const beforeCopies = [...copies.values()].map(c => c.server);
    const uploadedTo = [];
    const failed = [];

    if (copies.size >= requiredCopies) {
      healthy += 1;
      const row = {
        hash: entry.hash,
        path: entry.path,
        size,
        type: entry.type,
        status: 'healthy',
        beforeCopies,
        afterCopies: beforeCopies,
        uploadedTo,
        failed,
      };
      blobs.push(row);
      onProgress?.({ hash: entry.hash, path: entry.path, status: row.status, completed: i + 1, total: entries.length });
      continue;
    }

    if (!fetched) {
      try {
        fetched = await fetchVerified(entry.hash, {
          servers: [...beforeCopies, ...sources.filter(s => !beforeCopies.includes(s))],
          fetcher,
          signal,
          timeoutMs,
          maxBytes: size,
        });
      } catch (err) {
        if (err?.code === 'cancelled' || signal?.aborted) {
          throw sdkError('Replica repair cancelled', { code: 'cancelled', retryable: false, cause: err });
        }
        degraded += 1;
        const row = {
          hash: entry.hash,
          path: entry.path,
          size,
          type: entry.type,
          status: 'degraded',
          beforeCopies,
          afterCopies: beforeCopies,
          uploadedTo,
          failed: [{ stage: 'source-fetch', error: err?.message || String(err) }],
        };
        blobs.push(row);
        onProgress?.({ hash: entry.hash, path: entry.path, status: row.status, completed: i + 1, total: entries.length });
        continue;
      }
    }

    let missingTargets = targets.filter(s => !copies.has(new URL(s).origin));
    if (preflight && missingTargets.length) {
      const pf = await preflightBlob(metadata, { servers: missingTargets, fetcher, signal, timeoutMs });
      const ordered = [...pf.selected, ...pf.fallbacks];
      if (ordered.length) missingTargets = ordered;
    }

    for (const server of missingTargets) {
      if (copies.size >= requiredCopies) break;
      if (signal?.aborted) throw sdkError('Replica repair cancelled', { code: 'cancelled', retryable: false });
      try {
        const up = await uploader(new Uint8Array(fetched.data), {
          server,
          signer,
          pubkey,
          path: entry.path,
          expectedType: entry.type,
          verifyContentType: true,
          fetcher,
          signal,
          clock,
          timeoutMs,
        });
        if (!up?.verified || up.hash !== entry.hash) throw new Error('Unverified repair upload');
        if (
          uploader === uploadVerified &&
          up.typeVerified === true &&
          up.size === size &&
          up.server === server
        ) {
          copies.set(new URL(server).origin, {
            server,
            hash: entry.hash,
            size,
            type: entry.type,
            verified: true,
          });
        } else {
          const check = await verifyBlobCopies(metadata, {
            servers: [server],
            required: 1,
            fetcher,
            signal,
            timeoutMs,
          });
          if (!check.copies.length) throw new Error('Repair copy readback failed');
          copies.set(new URL(server).origin, check.copies[0]);
        }
        uploadedTo.push(server);
      } catch (err) {
        if (err?.code === 'cancelled' || signal?.aborted) {
          throw sdkError('Replica repair cancelled', { code: 'cancelled', retryable: false, cause: err });
        }
        failed.push({ server, code: err?.code || 'upload-failed', error: err?.message || String(err) });
      }
    }

    const afterCopies = [...copies.values()].map(c => c.server);
    const status = copies.size >= requiredCopies ? 'repaired' : 'degraded';
    if (status === 'repaired') repaired += 1;
    else degraded += 1;

    blobs.push({
      hash: entry.hash,
      path: entry.path,
      size,
      type: entry.type,
      status,
      beforeCopies,
      afterCopies,
      uploadedTo,
      failed,
    });
    onProgress?.({ hash: entry.hash, path: entry.path, status, completed: i + 1, total: entries.length });
  }

  const overall = degraded === 0 ? 'healthy' : healthy + repaired > 0 ? 'partial' : 'degraded';
  return {
    status: overall,
    requiredCopies,
    totalBlobs: entries.length,
    healthy,
    repaired,
    degraded,
    blobs,
  };
}
