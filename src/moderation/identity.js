/** Recovered from MojiSurvivor moderation lists; portable NIP-19 & hash normalization helpers. */
import {
  decodeNip19,
  noteEncode,
  nprofileEncode,
  neventEncode,
  naddrEncode,
  normalizePubkey,
} from '../nostr/nip19.js';

export { decodeNip19, noteEncode, nprofileEncode, neventEncode, naddrEncode, normalizePubkey };

const VALID_HEX = /^[a-f\d]{64}$/i;

export function normalizeEmojiHash(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim().replace(/^sha256:/i, '').replace(/^#/, '');
  return VALID_HEX.test(t) ? t.toLowerCase() : null;
}

export function normalizePubkeyList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizePubkey).filter(Boolean))];
}

export function normalizeHashList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeEmojiHash).filter(Boolean))];
}
