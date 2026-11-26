/** Byte transformations independent of framework and runtime. */
export const encode = text => new TextEncoder().encode(String(text));
export const decode = data => new TextDecoder('utf-8', { fatal: true }).decode(bytes(data));
export const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export function unhex(value) {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})*$/i.test(value)) throw new TypeError('Expected even-length hexadecimal');
  return Uint8Array.from(value.match(/../g) || [], h => parseInt(h, 16));
}
export function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'string') return encode(value);
  throw new TypeError('Expected string, Uint8Array or ArrayBuffer');
}
export async function sha256(value, { cryptoProvider = globalThis.crypto } = {}) {
  if (!cryptoProvider?.subtle) throw new Error('Secure Web Crypto required for SHA-256');
  return hex(new Uint8Array(await cryptoProvider.subtle.digest('SHA-256', bytes(value))));
}
function bytesToBinaryString(data) {
  const CHUNK = 8192;
  const parts = [];
  for (let i = 0; i < data.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, data.subarray(i, i + CHUNK)));
  }
  return parts.join('');
}
export function toBase64(value) {
  const data = bytes(value);
  if (typeof Buffer !== 'undefined') return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
  return btoa(bytesToBinaryString(data));
}
export function toBase64Url(value) {
  const data = bytes(value);
  if (typeof Buffer !== 'undefined') return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64url');
  return btoa(bytesToBinaryString(data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new TypeError('Expected base64url string');
  }
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(value, 'base64url');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

