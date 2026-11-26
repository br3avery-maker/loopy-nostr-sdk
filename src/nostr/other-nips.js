import { eventTemplate, checkedSign } from './events.js';
import { endpoint } from '../core/urls.js';
import { encode, sha256, toBase64 } from '../core/bytes.js';

/** NIP-42 authentication: challenge and relay binding are mandatory; no automatic signing. */
export function relayAuthTemplate({ challenge, relay, created_at = Math.floor(Date.now() / 1000) } = {}) {
  if (typeof challenge !== 'string' || !challenge || challenge.length > 512) throw new TypeError('Relay AUTH challenge required');
  return eventTemplate({ kind: 22242, created_at, tags: [['relay', endpoint(relay)], ['challenge', challenge]], content: '' });
}

/** NIP-98 HTTP auth signer; caller must supply the exact request URL and method (and optional payload body). */
export async function httpAuthHeader({ url, method, payload, signer, pubkey, created_at = Math.floor(Date.now() / 1000) } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password) throw new TypeError('HTTPS URL without credentials required');
  const normalizedMethod = typeof method === 'string' ? method.trim().toUpperCase() : '';
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(normalizedMethod)) throw new TypeError('HTTP method required');
  // Strip URL fragments which are never sent over HTTP.
  u.hash = '';
  const tags = [['u', u.href], ['method', normalizedMethod]];
  if (payload !== undefined && payload !== null) {
    tags.push(['payload', await sha256(payload)]);
  }
  const event = await checkedSign(signer, eventTemplate({ kind: 27235, created_at, tags, content: '' }), pubkey);
  // NIP-98 uses standard padded Base64, unlike Blossom's base64url encoding.
  return 'Nostr ' + toBase64(encode(JSON.stringify(event)));
}

/** NIP-44 encryption adapter. A trusted signer must provide approved nip44 operations. */
export function encryptionAdapter(signer) {
  const api = signer?.nip44;
  if (typeof api?.encrypt !== 'function' || typeof api?.decrypt !== 'function') {
    throw new Error('Signer does not provide approved NIP-44 methods');
  }
  return {
    encrypt: (peer, plaintext) => api.encrypt(peer, plaintext),
    decrypt: (peer, ciphertext) => api.decrypt(peer, ciphertext),
  };
}
