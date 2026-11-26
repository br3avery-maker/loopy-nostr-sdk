import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent as rawVerifyEvent, npubEncode } from '../../vendor/nostr.js';
import { isHex, assertHex, hasLoneSurrogate } from '../core/guards.js';

export { finalizeEvent, generateSecretKey, getPublicKey, npubEncode };

/** Reconstruct a clean event so nostr-tools verification cache symbols cannot mask tampering. */
export function verifyEvent(event) {
  try {
    if (!event || !isHex(event.id, 64) || !isHex(event.pubkey, 64) || !isHex(event.sig, 128)) return false;
    return rawVerifyEvent({
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      created_at: event.created_at,
      content: event.content,
      tags: structuredClone(event.tags),
      sig: event.sig,
    });
  } catch {
    return false;
  }
}

export function eventTemplate({ kind = 1, content = '', tags = [], created_at = Math.floor(Date.now() / 1000) } = {}) {
  if (
    !Number.isSafeInteger(kind) || kind < 0 || kind > 65535 ||
    !Number.isSafeInteger(created_at) || created_at < 0 ||
    typeof content !== 'string' || hasLoneSurrogate(content) ||
    !Array.isArray(tags) ||
    tags.some(t => !Array.isArray(t) || t.length < 1 || t.some(x => typeof x !== 'string' || hasLoneSurrogate(x)))
  ) {
    throw new TypeError('Invalid unsigned Nostr event');
  }
  return { kind, content, tags, created_at };
}

export function assertSignedEvent(event, { verify = verifyEvent } = {}) {
  if (
    !event ||
    !isHex(event.id, 64) ||
    !isHex(event.pubkey, 64) ||
    !isHex(event.sig, 128) ||
    !Number.isSafeInteger(event.kind) || event.kind < 0 || event.kind > 65535 ||
    !Number.isSafeInteger(event.created_at) || event.created_at < 0 ||
    typeof event.content !== 'string' ||
    !Array.isArray(event.tags)
  ) {
    throw new Error('Invalid Nostr event signature or contents');
  }
  const clean = {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    created_at: event.created_at,
    content: event.content,
    tags: structuredClone(event.tags),
    sig: event.sig,
  };
  const ok = verify === verifyEvent ? rawVerifyEvent(clean) : verify(clean);
  if (!ok) throw new Error('Invalid Nostr event signature or contents');
  return event;
}

export async function checkedSign(signer, template, expectedPubkey, { verify = verifyEvent } = {}) {
  if (!signer || typeof signer.signEvent !== 'function') throw new TypeError('Signer must implement signEvent');
  assertHex(expectedPubkey, 64, 'expectedPubkey');
  // Snapshot the approved wire fields before calling an injected signer.
  const approved = eventTemplate(template);
  const snapshot = structuredClone(approved);
  const signed = await signer.signEvent(structuredClone(snapshot));
  assertSignedEvent(signed, { verify });
  if (
    signed.pubkey !== expectedPubkey ||
    signed.kind !== snapshot.kind ||
    signed.content !== snapshot.content ||
    signed.created_at !== snapshot.created_at ||
    JSON.stringify(signed.tags) !== JSON.stringify(snapshot.tags)
  ) {
    throw new Error('Signer changed approved event or account');
  }
  return {
    id: signed.id,
    pubkey: signed.pubkey,
    kind: signed.kind,
    created_at: signed.created_at,
    content: signed.content,
    tags: structuredClone(signed.tags),
    sig: signed.sig,
  };
}
