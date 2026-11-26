import { finalizeEvent, generateSecretKey, getPublicKey } from '../../vendor/nostr.js';
import { sha256, encode } from '../core/bytes.js';
import { isHex, assertSafeInt } from '../core/guards.js';
import { eventTemplate } from './events.js';
import { verifiedCopy } from './history.js';

const nowSeconds = () => Math.floor(Date.now() / 1000);

function randomOffsetSeconds(maxSeconds) {
  if (maxSeconds <= 0) return 0;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % (maxSeconds + 1);
}

/**
 * Compute canonical NIP-01 event ID for an unsigned rumor (`[0, pubkey, created_at, kind, tags, content]`).
 */
async function canonicalRumorId(rumor) {
  const payload = JSON.stringify([0, rumor.pubkey, rumor.created_at, rumor.kind, rumor.tags, rumor.content]);
  return sha256(encode(payload));
}

/**
 * Build an unsigned NIP-59 rumor (default kind 14 NIP-17 private direct message).
 * Rumors MUST NEVER be signed or published directly to relays.
 */
export async function rumorTemplate({
  pubkey,
  kind = 14,
  content = '',
  tags = [],
  created_at = nowSeconds(),
} = {}) {
  if (!isHex(pubkey, 64)) throw new TypeError('64-character lowercase hex author pubkey required');
  const template = eventTemplate({ kind, content, tags, created_at });
  const rumor = {
    pubkey,
    kind: template.kind,
    created_at: template.created_at,
    tags: template.tags,
    content: template.content,
  };
  return {
    id: await canonicalRumorId(rumor),
    ...rumor,
  };
}

/**
 * Encrypt an unsigned NIP-59 rumor into an unsigned kind 13 seal template for external signing.
 * Requires an injected NIP-44 compatible encryptor (`{ encrypt(peerPubkey, plaintext) }`).
 */
export async function sealTemplate(
  rumor,
  { recipientPubkey, encryptor, created_at = nowSeconds(), jitterSeconds = 0 } = {}
) {
  if (!rumor || typeof rumor !== 'object' || Array.isArray(rumor)) throw new TypeError('Rumor object required');
  if ('sig' in rumor && rumor.sig !== undefined) {
    throw new TypeError('NIP-59 rumor must be unsigned (sig field must not be present)');
  }
  if (!isHex(rumor.pubkey, 64)) throw new TypeError('Rumor must include valid 64-hex pubkey');
  if (!isHex(recipientPubkey, 64)) throw new TypeError('Valid 64-hex recipientPubkey required');
  if (!encryptor || typeof encryptor.encrypt !== 'function') {
    throw new TypeError('NIP-44 encryptor with encrypt(peer, plaintext) required');
  }
  assertSafeInt(created_at, { min: 0, label: 'created_at' });
  assertSafeInt(jitterSeconds, { min: 0, max: 172800, label: 'jitterSeconds' });

  const normalized = eventTemplate({
    kind: rumor.kind,
    content: rumor.content,
    tags: rumor.tags,
    created_at: rumor.created_at,
  });
  const cleanRumor = {
    pubkey: rumor.pubkey,
    kind: normalized.kind,
    created_at: normalized.created_at,
    tags: normalized.tags,
    content: normalized.content,
  };
  const expectedId = await canonicalRumorId(cleanRumor);
  if (rumor.id !== undefined && rumor.id !== expectedId) {
    throw new Error('Rumor id does not match canonical NIP-01 hash');
  }

  const plaintext = JSON.stringify({ id: expectedId, ...cleanRumor });
  const ciphertext = await encryptor.encrypt(recipientPubkey, plaintext);
  if (typeof ciphertext !== 'string' || !ciphertext) {
    throw new Error('Encryptor returned empty ciphertext for seal');
  }
  const timestamp = Math.max(0, created_at - randomOffsetSeconds(jitterSeconds));
  return eventTemplate({
    kind: 13,
    created_at: timestamp,
    tags: [],
    content: ciphertext,
  });
}

/**
 * Wrap a signed kind 13 seal into a fresh ephemeral-key kind 1059 NIP-59 gift wrap.
 * Uses an injected `encryptorForEphemeral(ephemeralSecretKey)` factory so cryptography stays pluggable.
 */
export async function giftWrapEvent(
  sealEvent,
  {
    recipientPubkey,
    encryptorForEphemeral,
    created_at = nowSeconds(),
    jitterSeconds = 0,
    ephemeralSecretKey,
  } = {}
) {
  const seal = verifiedCopy(sealEvent);
  if (seal.kind !== 13) throw new TypeError('Gift wrap requires a verified kind 13 seal event');
  if (seal.tags.length !== 0) throw new TypeError('NIP-59 kind 13 seal must have empty tags');
  if (!isHex(recipientPubkey, 64)) throw new TypeError('Valid 64-hex recipientPubkey required');
  if (typeof encryptorForEphemeral !== 'function') {
    throw new TypeError('encryptorForEphemeral(secretKey) factory required');
  }
  assertSafeInt(created_at, { min: 0, label: 'created_at' });
  assertSafeInt(jitterSeconds, { min: 0, max: 172800, label: 'jitterSeconds' });

  const secret = ephemeralSecretKey ?? generateSecretKey();
  if (!(secret instanceof Uint8Array) || secret.byteLength !== 32) {
    throw new TypeError('ephemeralSecretKey must be a 32-byte Uint8Array');
  }
  const encryptor = await encryptorForEphemeral(secret);
  if (!encryptor || typeof encryptor.encrypt !== 'function') {
    throw new TypeError('encryptorForEphemeral must return an object with encrypt(peer, plaintext)');
  }

  const ciphertext = await encryptor.encrypt(recipientPubkey, JSON.stringify(seal));
  if (typeof ciphertext !== 'string' || !ciphertext) {
    throw new Error('Ephemeral encryptor returned empty ciphertext for gift wrap');
  }

  const timestamp = Math.max(0, created_at - randomOffsetSeconds(jitterSeconds));
  const template = eventTemplate({
    kind: 1059,
    created_at: timestamp,
    tags: [['p', recipientPubkey]],
    content: ciphertext,
  });
  const event = verifiedCopy(finalizeEvent(template, secret));
  return {
    event,
    ephemeralPubkey: getPublicKey(secret),
  };
}

/**
 * Verify and unwrap a kind 1059 NIP-59 gift wrap -> verified kind 13 seal -> verified unsigned rumor.
 * Enforces anti-spoofing (`rumor.pubkey === seal.pubkey`), rejects signed rumors, and checks rumor ID.
 */
export async function unwrapGiftWrap(wrapEvent, { recipientPubkey, decryptor } = {}) {
  if (recipientPubkey !== undefined && !isHex(recipientPubkey, 64)) {
    throw new TypeError('Valid 64-hex recipientPubkey required when provided');
  }
  if (!decryptor || typeof decryptor.decrypt !== 'function') {
    throw new TypeError('NIP-44 decryptor with decrypt(peer, ciphertext) required');
  }

  const wrap = verifiedCopy(wrapEvent);
  if (wrap.kind !== 1059) throw new TypeError('Expected kind 1059 gift-wrap event');
  if (recipientPubkey) {
    const pTags = wrap.tags.filter(t => t[0] === 'p' && t[1] === recipientPubkey);
    if (!pTags.length) throw new Error('Gift wrap is not addressed to expected recipient');
  }

  const sealJson = await decryptor.decrypt(wrap.pubkey, wrap.content);
  let rawSeal;
  try {
    rawSeal = JSON.parse(sealJson);
  } catch (cause) {
    throw new Error('Decrypted gift-wrap payload is not valid JSON', { cause });
  }
  const seal = verifiedCopy(rawSeal);
  if (seal.kind !== 13) throw new Error('Unwrapped inner event is not a kind 13 seal');
  if (seal.tags.length !== 0) throw new Error('Unwrapped kind 13 seal must have empty tags');

  const rumorJson = await decryptor.decrypt(seal.pubkey, seal.content);
  let rawRumor;
  try {
    rawRumor = JSON.parse(rumorJson);
  } catch (cause) {
    throw new Error('Decrypted seal payload is not valid JSON', { cause });
  }
  if (!rawRumor || typeof rawRumor !== 'object' || Array.isArray(rawRumor)) {
    throw new Error('Decrypted rumor must be an object');
  }
  if ('sig' in rawRumor && rawRumor.sig !== undefined) {
    throw new Error('Decrypted NIP-59 rumor must not carry a signature');
  }
  if (!isHex(rawRumor.pubkey, 64) || rawRumor.pubkey !== seal.pubkey) {
    throw new Error('Rumor pubkey does not match verified seal author');
  }

  const normalized = eventTemplate({
    kind: rawRumor.kind,
    content: rawRumor.content,
    tags: rawRumor.tags,
    created_at: rawRumor.created_at,
  });
  const rumorBody = {
    pubkey: rawRumor.pubkey,
    kind: normalized.kind,
    created_at: normalized.created_at,
    tags: normalized.tags,
    content: normalized.content,
  };
  const expectedId = await canonicalRumorId(rumorBody);
  if (rawRumor.id !== undefined && rawRumor.id !== expectedId) {
    throw new Error('Decrypted rumor id does not match canonical NIP-01 hash');
  }

  return {
    wrap,
    seal,
    rumor: { id: expectedId, ...rumorBody },
  };
}
