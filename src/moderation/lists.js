import { normalizePubkey, normalizeEmojiHash, normalizePubkeyList, normalizeHashList } from './identity.js';
import { safeHttpUrl } from '../core/guards.js';
import { assertSignedEvent, eventTemplate } from '../nostr/events.js';

// Public build: policy lists are caller-supplied; private curated data is not distributed.
export const MOJI_CURATOR_BLOCKLIST_VERSION = 'moji-curator-blocklist/v1';
export const BUILT_IN_NSFW_BAN_PUBKEYS = Object.freeze([]);
export const BUILT_IN_NSFW_MEDIA_URLS = Object.freeze([]);
export const BUILT_IN_NSFW_BLOB_HASHES = Object.freeze([]);

export function parseCuratorBlocklist(raw) {
  let v;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Blocklist JSON required');
  try { v = JSON.parse(raw); } catch { throw new Error('Invalid blocklist JSON'); }
  if (!v || typeof v !== 'object') throw new Error('Blocklist must be JSON array or object');
  const pubs = [];
  const hashes = [];
  const urls = [];
  function entry(obj, hint = 'auto') {
    if (typeof obj === 'string') {
      const trimmed = obj.trim();
      const isNpub = /^npub1/i.test(trimmed);
      if (hint === 'hash') {
        const h = normalizeEmojiHash(trimmed);
        if (h) hashes.push(h);
        return;
      }
      if (hint === 'pubkey') {
        const p = normalizePubkey(trimmed);
        if (p) pubs.push(p);
        return;
      }
      if (hint === 'media') {
        if (isNpub) {
          const p = normalizePubkey(trimmed);
          if (p) pubs.push(p);
        } else {
          const h = normalizeEmojiHash(trimmed);
          if (h) hashes.push(h);
          else {
            const u = safeHttpUrl(trimmed);
            if (u) urls.push(u);
          }
        }
        return;
      }
      const p = normalizePubkey(trimmed);
      const h = normalizeEmojiHash(trimmed);
      if (p) pubs.push(p);
      else if (h) hashes.push(h);
      else {
        const u = safeHttpUrl(trimmed);
        if (u) urls.push(u);
      }
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    for (const k of ['author', 'pubkey', 'sourceAddress']) {
      if (typeof obj[k] === 'string') {
        const p = normalizePubkey(k === 'sourceAddress' ? obj[k].split(':')[1] : obj[k]);
        if (p) pubs.push(p);
      }
    }
    if (typeof obj.hash === 'string') hashes.push(obj.hash);
    if (typeof obj.url === 'string') {
      const u = safeHttpUrl(obj.url);
      if (u) urls.push(u);
    }
  }
  if (Array.isArray(v)) v.slice(0, 10000).forEach(x => entry(x, 'auto'));
  else {
    // Never treat allowlists like 'safePubkeys' as blocked publishers.
    for (const k of ['blockedPublishers', 'nsfwBanPubkeys', 'pubkeys']) {
      if (Array.isArray(v[k])) v[k].slice(0, 10000).forEach(x => entry(x, 'pubkey'));
    }
    for (const k of ['nsfwBanEmojiHashes', 'emojiHashes', 'hashes']) {
      if (Array.isArray(v[k])) v[k].slice(0, 10000).forEach(x => entry(x, 'hash'));
    }
    if (Array.isArray(v.media)) v.media.slice(0, 10000).forEach(x => entry(x, 'media'));
    if (Array.isArray(v.blocked)) v.blocked.slice(0, 10000).forEach(x => entry(x, 'auto'));
  }
  return {
    schema: MOJI_CURATOR_BLOCKLIST_VERSION,
    pubkeys: normalizePubkeyList(pubs),
    emojiHashes: normalizeHashList(hashes),
    mediaUrls: [...new Set(urls)].slice(0, 10000),
  };
}

/** NIP-51: only verified signer output is accepted. Hashed words and private encrypted content are outside this parser. */
export function parseNip51MuteList(event) {
  if (event?.kind !== 10000) throw new Error('Expected NIP-51 kind 10000');
  assertSignedEvent(event);
  return {
    pubkey: event.pubkey,
    pubkeys: normalizePubkeyList(event.tags.filter(t => t[0] === 'p').map(t => t[1])),
    eventId: event.id,
    createdAt: event.created_at,
  };
}

export function muteListTemplate(pubkeys, { created_at = Math.floor(Date.now() / 1000) } = {}) {
  const tags = normalizePubkeyList(pubkeys).map(p => ['p', p]);
  return eventTemplate({ kind: 10000, content: '', tags, created_at });
}

/** No user decisions are silently replaced by fetched lists. */
export function mergeBlocklists(...lists) {
  const p = [];
  const h = [];
  const u = [];
  for (const l of lists) {
    p.push(...(l?.pubkeys || []));
    h.push(...(l?.emojiHashes || []));
    u.push(...(l?.mediaUrls || []));
  }
  return { pubkeys: normalizePubkeyList(p), emojiHashes: normalizeHashList(h), mediaUrls: [...new Set(u)] };
}

/** Precompile a stateless O(1) lookup policy for batch emoji filtering without hidden global caches. */
export function compileEmojiPolicy(policy = {}) {
  if (policy && policy.__compiledEmojiPolicy === true) return policy;
  return Object.freeze({
    __compiledEmojiPolicy: true,
    blockedEmojiKeys: new Set(policy?.blockedEmojiKeys || []),
    bannedPubkeys: new Set(
      normalizePubkeyList(policy?.bannedPubkeys === undefined ? BUILT_IN_NSFW_BAN_PUBKEYS : [...policy.bannedPubkeys])
    ),
    bannedEmojiHashes: new Set(
      normalizeHashList(policy?.bannedEmojiHashes === undefined ? BUILT_IN_NSFW_BLOB_HASHES : [...policy.bannedEmojiHashes])
    ),
    safePubkeys: new Set(normalizePubkeyList(policy?.safePubkeys ? [...policy.safePubkeys] : [])),
    filterMode: policy?.filterMode || 'default',
    isSignedIn: Boolean(policy?.isSignedIn),
    activeUserPubkey: normalizePubkey(policy?.activeUserPubkey),
  });
}

/** Default = block exact known publishers or hashes, never keywords/shortcodes. */
export function isEmojiAllowed(candidate, policy = {}) {
  if (candidate?.source === 'reserve') return true;
  const compiled = compileEmojiPolicy(policy);
  const author = normalizePubkey(candidate?.packAuthor);
  const hash = normalizeEmojiHash(candidate?.hash);
  if (candidate?.emojiKey && compiled.blockedEmojiKeys.has(candidate.emojiKey)) return false;
  if (author && compiled.bannedPubkeys.has(author)) return false;
  if (hash && compiled.bannedEmojiHashes.has(hash)) return false;
  if (compiled.filterMode === 'safe_list_only') {
    return !!author && (compiled.safePubkeys.has(author) || Boolean(compiled.isSignedIn && author === compiled.activeUserPubkey));
  }
  return true;
}
