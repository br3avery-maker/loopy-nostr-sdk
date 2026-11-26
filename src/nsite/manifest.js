import { sha256, bytes, encode } from '../core/bytes.js';
import { nsitePath, slug, endpoint } from '../core/urls.js';
import { isHex, assertSafeInt, canonicalGatewayHost } from '../core/guards.js';
import { assertSignedEvent, npubEncode } from '../nostr/events.js';

export const NSITE_ROOT_KIND = 15128;
export const NSITE_NAMED_KIND = 35128;

export function nsiteAddress(pubkey, { identifier = '', gateway = 'nsite.lol' } = {}) {
  if (!isHex(pubkey, 64)) throw new TypeError('64-character pubkey required');
  const host = canonicalGatewayHost(gateway);
  return identifier
    ? `https://${BigInt('0x' + pubkey).toString(36).padStart(50, '0')}${slug(identifier)}.${host}/`
    : `https://${npubEncode(pubkey)}.${host}/`;
}

/** NIP-5A path hash / aggregate convention recovered from Nsite Directory Editor. */
export async function prepareManifestFiles(
  input,
  { maxFiles = 20000, maxBytes = 128 * 1024 * 1024, emptyFiles = 'reject' } = {}
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('File map required');
  assertSafeInt(maxFiles, { min: 1, max: 200000, label: 'maxFiles' });
  assertSafeInt(maxBytes, { min: 1, max: 1024 * 1024 * 1024, label: 'maxBytes' });
  if (emptyFiles !== 'reject' && emptyFiles !== 'skip') {
    throw new TypeError("emptyFiles must be 'reject' or 'skip'");
  }
  const entries = [];
  const skippedEmpty = [];
  const paths = new Set();
  let totalBytes = 0;
  for (const [raw, value] of Object.entries(input)) {
    const path = nsitePath(raw);
    if (paths.has(path)) throw new Error('Duplicate path: ' + path);
    paths.add(path);
    const data = new Uint8Array(bytes(value));
    if (!data.length) {
      if (emptyFiles === 'skip') {
        skippedEmpty.push(path);
        continue;
      }
      throw new Error('Empty file: ' + path);
    }
    totalBytes += data.byteLength;
    if (totalBytes > maxBytes) throw new RangeError('Nsite exceeds byte limit');
    entries.push({ path, bytes: data, size: data.byteLength });
    if (entries.length > maxFiles) throw new RangeError('Too many files');
  }
  if (!entries.length) throw new Error('No files in nsite');
  for (const entry of entries) entry.hash = await sha256(entry.bytes);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const aggregate = await sha256(encode(entries.map(({ hash, path }) => `${hash} ${path}\n`).sort().join('')));
  const result = { entries, aggregate, totalBytes };
  if (skippedEmpty.length) result.skippedEmpty = skippedEmpty.sort((a, b) => a.localeCompare(b));
  return result;
}

export function manifestTemplate(
  prepared,
  { identifier = '', server, title = '', description = '', created_at = Math.floor(Date.now() / 1000) } = {}
) {
  if (!prepared?.entries?.length || !isHex(prepared.aggregate, 64)) throw new TypeError('Call prepareManifestFiles');
  assertSafeInt(created_at, { min: 0, label: 'created_at' });
  const kind = identifier ? NSITE_NAMED_KIND : NSITE_ROOT_KIND;
  if (identifier) slug(identifier);
  const tags = [
    ...(identifier ? [['d', identifier]] : []),
    ...prepared.entries.map(e => ['path', e.path, e.hash]),
    ['x', prepared.aggregate, 'aggregate'],
  ];
  if (server) tags.push(['server', endpoint(server, 'blossom')]);
  if (title) tags.push(['title', String(title)]);
  if (description) tags.push(['description', String(description)]);
  return { kind, created_at, content: '', tags };
}

export async function parseManifest(event, { verify = true, now = Math.floor(Date.now() / 1000) } = {}) {
  if (![NSITE_ROOT_KIND, NSITE_NAMED_KIND].includes(event?.kind)) throw new TypeError('Not an nsite manifest');
  assertSafeInt(now, { min: 0, label: 'now' });
  event = structuredClone(event);
  if (verify) assertSignedEvent(event);
  if (event.created_at > now + 300) throw new Error('Future nsite manifest');
  const ident = event.kind === NSITE_NAMED_KIND ? (event.tags.find(t => t[0] === 'd')?.[1] || '') : '';
  if (event.kind === NSITE_NAMED_KIND) slug(ident);
  const paths = event.tags.filter(t => t[0] === 'path');
  if (!paths.length || paths.length > 20000) throw new Error('Bad manifest path count');
  const files = new Map();
  for (const tag of paths) {
    const path = nsitePath(tag[1]);
    if (!isHex(tag[2], 64) || files.has(path)) throw new Error('Bad or duplicate path');
    files.set(path, tag[2]);
  }
  const aggregate = await sha256(encode([...files].map(([p, h]) => `${h} ${p}\n`).sort().join('')));
  const declared = event.tags.filter(t => t[0] === 'x' && t[2] === 'aggregate');
  if (
    declared.length
      ? declared.some(t => t[1] !== aggregate)
      : event.tags.some(t => t[0] === 'x' && t.length === 2 && t[1] !== aggregate)
  ) {
    throw new Error('Manifest aggregate mismatch');
  }
  return {
    pubkey: event.pubkey,
    kind: event.kind,
    created_at: event.created_at,
    identifier: ident,
    aggregate,
    files: [...files].map(([path, hash]) => ({ path, hash })),
    url: nsiteAddress(event.pubkey, { identifier: ident }),
    eventId: event.id,
    verified: verify,
  };
}
