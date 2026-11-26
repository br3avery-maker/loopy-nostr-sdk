import { nsitePath } from '../core/urls.js';
import { bytes, sha256 } from '../core/bytes.js';

const MEDIA_TYPES = Object.freeze({
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
  webmanifest: 'application/manifest+json',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
});

export function mediaType(path) {
  const filename = String(path ?? '').split('/').pop() || '';
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return 'application/octet-stream';
  const ext = filename.slice(dot + 1).toLowerCase();
  return MEDIA_TYPES[ext] || 'application/octet-stream';
}

export function normalizeFileMap(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('File map object required');
  }
  const out = Object.create(null);
  for (const [name, data] of Object.entries(input)) {
    const path = nsitePath(name).slice(1);
    if (Object.hasOwn(out, path)) throw new Error('Repeated file path');
    out[path] = bytes(data);
  }
  return out;
}

export async function compareFiles(before, after) {
  const a = normalizeFileMap(before);
  const b = normalizeFileMap(after);
  const changes = [];
  for (const path of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[path]) changes.push({ path, change: 'added', to: await sha256(b[path]) });
    else if (!b[path]) changes.push({ path, change: 'deleted', from: await sha256(a[path]) });
    else {
      const x = await sha256(a[path]);
      const y = await sha256(b[path]);
      if (x !== y) changes.push({ path, change: 'modified', from: x, to: y });
    }
  }
  return changes.sort((x, y) => x.path.localeCompare(y.path));
}

const WINDOWS_RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
const WINDOWS_ILLEGAL_CHAR = /[<>:"|?*]/;

/**
 * Pure static-site path portability checker.
 * Flags case-insensitive collisions, Unicode NFC/NFD collisions, Windows-reserved
 * segment names, illegal Windows characters, and trailing dots/spaces.
 */
export function checkPortablePaths(input) {
  const rawPaths = Array.isArray(input)
    ? input
    : input && typeof input === 'object'
      ? Object.keys(input)
      : null;
  if (!rawPaths) throw new TypeError('Path list or file map object required');

  const normalized = rawPaths.map(p => nsitePath(p));
  const issues = [];
  const byLower = new Map();
  const byNfc = new Map();

  for (const path of normalized) {
    const lower = path.toLowerCase();
    const lowerGroup = byLower.get(lower) ?? [];
    lowerGroup.push(path);
    byLower.set(lower, lowerGroup);

    const nfc = path.normalize('NFC');
    const nfcGroup = byNfc.get(nfc) ?? [];
    nfcGroup.push(path);
    byNfc.set(nfc, nfcGroup);

    const segments = path.slice(1).split('/');
    for (const seg of segments) {
      if (WINDOWS_RESERVED_SEGMENT.test(seg)) {
        issues.push({ code: 'windows-reserved', path, segment: seg, message: `Reserved Windows filename segment "${seg}"` });
      }
      if (WINDOWS_ILLEGAL_CHAR.test(seg)) {
        issues.push({ code: 'windows-illegal-char', path, segment: seg, message: `Windows-illegal character in "${seg}"` });
      }
      if (seg.endsWith('.') || seg.endsWith(' ')) {
        issues.push({ code: 'trailing-dot-or-space', path, segment: seg, message: `Trailing dot or space in "${seg}"` });
      }
    }
  }

  for (const group of byLower.values()) {
    const unique = [...new Set(group)].sort();
    if (unique.length > 1) {
      issues.push({
        code: 'case-collision',
        paths: unique,
        message: `Case-insensitive path collision: ${unique.join(', ')}`,
      });
    }
  }

  for (const group of byNfc.values()) {
    const unique = [...new Set(group)].sort();
    if (unique.length > 1) {
      issues.push({
        code: 'unicode-normalization-collision',
        paths: unique,
        message: `Unicode NFC/NFD path collision: ${unique.join(', ')}`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    checked: normalized.length,
    issues,
  };
}

