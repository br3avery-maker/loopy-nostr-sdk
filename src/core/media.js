/** Stateless MIME lookup and Blossom/Gateway content-type equivalence helpers. */

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

const JS_MEDIA_TYPES = Object.freeze(['text/javascript', 'application/javascript', 'application/x-javascript']);
const ICON_MEDIA_TYPES = Object.freeze(['image/x-icon', 'image/vnd.microsoft.icon']);

export function mediaType(path) {
  const filename = String(path ?? '').split('/').pop() || '';
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return 'application/octet-stream';
  const ext = filename.slice(dot + 1).toLowerCase();
  return MEDIA_TYPES[ext] || 'application/octet-stream';
}

export function baseMediaType(value) {
  return String(value ?? '').split(';')[0].trim().toLowerCase();
}

export function contentTypeMatches(expected, actual) {
  const exp = baseMediaType(expected);
  const act = baseMediaType(actual);
  return (
    act === exp ||
    (JS_MEDIA_TYPES.includes(exp) && JS_MEDIA_TYPES.includes(act)) ||
    (ICON_MEDIA_TYPES.includes(exp) && ICON_MEDIA_TYPES.includes(act))
  );
}
