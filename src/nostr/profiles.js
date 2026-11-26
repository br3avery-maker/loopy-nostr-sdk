import { assertSignedEvent } from './events.js';
import { queryRelay } from './relay-transport.js';
import { endpoints } from '../core/urls.js';
import { isHex, safeHttpUrl } from '../core/guards.js';

/** Parse kind0 metadata, preserving only safe serializable profile fields; never HTML or unsafe URL schemes. */
export function parseProfile(event) {
  if (event?.kind !== 0) throw new TypeError('Expected kind 0 profile');
  assertSignedEvent(event);
  let p;
  try { p = JSON.parse(event.content); } catch { throw new Error('Invalid kind0 metadata JSON'); }
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Invalid profile object');
  const out = { pubkey: event.pubkey, updated: event.created_at };
  for (const k of ['name', 'display_name', 'about', 'nip05']) {
    if (typeof p[k] === 'string') out[k] = p[k].slice(0, k === 'about' ? 4096 : 1024);
  }
  for (const k of ['picture', 'banner', 'website']) {
    if (typeof p[k] === 'string') {
      const safe = safeHttpUrl(p[k], { allowHttp: k === 'website', maxLength: 1024 });
      if (safe) out[k] = safe;
    }
  }
  return out;
}

/** Fetch bounded per-author observations, without sharing the feed's global event budget. */
export async function fetchProfiles({ pubkeys = [], relays = [], query = queryRelay, signal, timeoutMs, Socket } = {}) {
  if (!Array.isArray(pubkeys) || !pubkeys.length) throw new Error('Provide at least one author pubkey');
  const authors = [...new Set(pubkeys)];
  if (authors.some(key => !isHex(key, 64))) throw new TypeError('Expected hex author pubkeys');
  const urls = endpoints(relays, 'relay', 24), winners = new Map(), failures = [];
  const total = authors.length * urls.length;
  let next = 0, queried = false;
  const transportOpts = (signal !== undefined || timeoutMs !== undefined || Socket !== undefined)
    ? { ...(signal !== undefined ? { signal } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(Socket !== undefined ? { Socket } : {}) }
    : undefined;

  async function worker() {
    while (next < total) {
      if (signal?.aborted) return;
      const index = next++, pubkey = authors[Math.floor(index / urls.length)], relay = urls[index % urls.length];
      try {
        const observed = transportOpts
          ? await query(relay, { authors: [pubkey], kinds: [0], limit: 100 }, transportOpts)
          : await query(relay, { authors: [pubkey], kinds: [0], limit: 100 });
        if (!Array.isArray(observed)) throw new TypeError('Malformed relay result');
        queried = true;
        for (const event of observed) {
          if (event?.pubkey !== pubkey || event.kind !== 0) continue;
          try {
            const profile = parseProfile(event), previous = winners.get(pubkey);
            if (!previous || profile.updated > previous.profile.updated || (profile.updated === previous.profile.updated && event.id < previous.id)) {
              winners.set(pubkey, { id: event.id, profile });
            }
          } catch {}
        }
      } catch (error) {
        failures.push({ index, relay, pubkey, error: String(error?.message ?? error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(16, total) }, () => worker()));
  if (signal?.aborted) throw new Error('Profile retrieval cancelled');
  const profiles = new Map(authors.filter(key => winners.has(key)).map(key => [key, winners.get(key).profile]));
  return {
    profiles,
    failed: failures.sort((a, b) => a.index - b.index).map(({ index, ...failure }) => failure),
    status: queried ? 'queried' : 'unreachable',
  };
}
