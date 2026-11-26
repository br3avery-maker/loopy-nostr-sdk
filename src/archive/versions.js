import { sha256 } from '../core/bytes.js';
import { nsitePath } from '../core/urls.js';
import { isHex } from '../core/guards.js';

/** Deterministic reconstruction of a historical version from stored paths and CAS objects. */
export async function materializeVersion(manifest, store, { maxFiles = 20000, maxBytes = 128 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Array.isArray(manifest?.files) || manifest.files.length > maxFiles) {
    throw new Error('Invalid version recovery limits');
  }
  const files = Object.create(null);
  const seen = new Set();
  let total = 0;
  const entries = manifest.files.map(entry => {
    const path = nsitePath(entry.path).slice(1);
    const hash = entry.hash;
    if (seen.has(path) || !isHex(hash, 64)) throw new Error('Invalid or duplicate version path ' + path);
    seen.add(path);
    return { path, hash };
  });
  for (const { path, hash } of entries) {
    const raw = await store.get(hash);
    if (!(raw instanceof Uint8Array)) throw new Error('Missing content for ' + path);
    total += raw.length;
    if (total > maxBytes) throw new Error('Version recovery byte limit exceeded');
    const value = new Uint8Array(raw);
    if ((await sha256(value)) !== hash) throw new Error('Corrupt content for ' + path);
    files[path] = value;
  }
  return files;
}

export function diffVersions(previous, next) {
  const a = new Map(previous.files.map(f => [nsitePath(f.path), f.hash]));
  const b = new Map(next.files.map(f => [nsitePath(f.path), f.hash]));
  const changes = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(path) !== b.get(path)) {
      changes.push({
        path,
        kind: !a.has(path) ? 'added' : !b.has(path) ? 'deleted' : 'changed',
        before: a.get(path) || null,
        after: b.get(path) || null,
      });
    }
  }
  return changes.sort((x, y) => x.path.localeCompare(y.path));
}

export function groupVersions(versions) {
  if (!Array.isArray(versions)) throw new TypeError('Versions array required');
  const out = new Map();
  for (const v of versions) {
    if (!v || typeof v !== 'object') continue;
    const key = v.kind === 35128 ? `${v.pubkey}:35128:${v.identifier ?? ''}` : `${v.pubkey}:15128`;
    const group = out.get(key) || [];
    group.push(v);
    out.set(key, group);
  }
  for (const a of out.values()) {
    a.sort((x, y) => (y.created_at || 0) - (x.created_at || 0) || String(x.eventId ?? x.id ?? '').localeCompare(String(y.eventId ?? y.id ?? '')));
  }
  return out;
}
