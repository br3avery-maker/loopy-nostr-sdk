/** Byte transformations independent of framework and runtime. */
export const encode = text => new TextEncoder().encode(String(text));
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
export function toBase64Url(value) {
  const data = bytes(value);
  if (typeof Buffer !== 'undefined') return Buffer.from(data).toString('base64url');
  let binary = ''; for (const c of data) binary += String.fromCharCode(c);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
