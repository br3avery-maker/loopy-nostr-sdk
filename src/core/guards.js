/** Pure, stateless validation and protocol-classification primitives shared across all SDK bricks. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isHex(value, length = 64) {
  if (typeof value !== 'string') return false;
  if (!Number.isSafeInteger(length) || length < 1) throw new RangeError('Invalid hex length');
  if (value.length !== length) return false;
  for (let i = 0; i < length; i++) {
    const c = value.charCodeAt(i);
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
  }
  return true;
}

export function assertHex(value, length = 64, label = 'hex') {
  if (!isHex(value, length)) throw new TypeError(`Invalid ${label}: expected ${length}-character lowercase hex`);
  return value;
}

/** Reject unpaired UTF-16 surrogates so JSON.stringify and UTF-8 SHA-256 agree across runtimes. */
export function hasLoneSurrogate(text) {
  if (typeof text !== 'string') return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function assertSafeInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER, label = 'integer' } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`Invalid ${label}: expected integer in ${min}..${max}`);
  }
  return value;
}

export function isForbiddenKey(key) {
  return typeof key !== 'string' || FORBIDDEN_KEYS.has(key);
}

/** Strict URL sanitizer for untrusted profile/media/callback HTTP(S) links. Returns null if disallowed. */
export function safeHttpUrl(input, { allowHttp = false, maxLength = 2048 } = {}) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  let url;
  try { url = new URL(trimmed); } catch { return null; }
  const allowed = allowHttp ? (url.protocol === 'https:' || url.protocol === 'http:') : url.protocol === 'https:';
  if (!allowed || !url.hostname || url.username || url.password) return null;
  return url.href;
}

export function assertSafeHttpUrl(input, options = {}) {
  const safe = safeHttpUrl(input, options);
  if (!safe) throw new TypeError('Disallowed or invalid HTTP(S) URL');
  return safe;
}

/** Canonical RFC-1123 public DNS hostname for nsite gateways (shared by manifest & plan bricks). */
export function canonicalGatewayHost(input) {
  if (typeof input !== 'string') throw new TypeError('Invalid gateway hostname');
  const host = input.trim().toLowerCase().replace(/\.$/, '');
  if (
    !host ||
    host.length > 253 ||
    !host.includes('.') ||
    /^[0-9.]+$/.test(host) ||
    host.includes(':') ||
    /\.(?:localhost|local|internal)$/.test(host) ||
    !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new TypeError('Invalid explicit gateway hostname');
  }
  return host;
}

/** Canonical NIP-01 storage class for event kinds 0..65535. */
export function classifyEventStorage(kind) {
  assertSafeInt(kind, { min: 0, max: 65535, label: 'event kind' });
  if (kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)) return 'replaceable';
  if (kind >= 20000 && kind < 30000) return 'ephemeral';
  if (kind >= 30000 && kind < 40000) return 'addressable';
  return 'regular';
}

/** Zero-side-effect runtime capability snapshot for browser, WebView, and Node hosts. */
export function checkRuntimeCapabilities(env = globalThis) {
  const g = env && typeof env === 'object' ? env : {};
  const subtleCrypto = typeof g.crypto?.subtle?.digest === 'function';
  const webSocket = typeof g.WebSocket === 'function';
  const fetchAvailable = typeof g.fetch === 'function';
  const indexedDB = typeof g.indexedDB?.open === 'function';
  const decompressionStream = typeof g.DecompressionStream === 'function';
  const secureContext = typeof g.isSecureContext === 'boolean' ? g.isSecureContext : subtleCrypto;
  const browserNip07 = typeof g.window?.nostr?.getPublicKey === 'function' && typeof g.window?.nostr?.signEvent === 'function';
  return {
    subtleCrypto,
    webSocket,
    fetch: fetchAvailable,
    indexedDB,
    decompressionStream,
    secureContext,
    browserNip07,
  };
}
