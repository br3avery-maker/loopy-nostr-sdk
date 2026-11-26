import { assertSignedEvent, eventTemplate } from './events.js';
import { verifiedCopy } from './history.js';
import { endpoints, endpoint } from '../core/urls.js';
import { assertSafeInt } from '../core/guards.js';
import { boundedFetch, defaultFetch } from '../core/http.js';

/** NIP-65 author kind 10002 relay list. Invalid/untrusted lists never silently replace saved endpoints. */
export function relayList(event, { verify = true } = {}) {
  if (event?.kind !== 10002) throw new TypeError('Not a kind 10002 relay list');
  if (verify) assertSignedEvent(event);
  const entries = [];
  for (const tag of event.tags || []) {
    if (tag[0] !== 'r') continue;
    try {
      const url = endpoint(tag[1]);
      const mode = tag[2];
      if (mode !== undefined && mode !== '' && mode !== 'read' && mode !== 'write') continue;
      entries.push({ url, read: mode !== 'write', write: mode !== 'read' });
    } catch {}
  }
  const merged = new Map();
  for (const e of entries) {
    const prior = merged.get(e.url) || { url: e.url, read: false, write: false };
    prior.read ||= e.read;
    prior.write ||= e.write;
    merged.set(e.url, prior);
  }
  return [...merged.values()];
}

export function planRelays({ authorList = [], recipientLists = [], defaults = [], max = 8 } = {}) {
  const limit = assertSafeInt(max, { min: 0, max: 128, label: 'max' });
  const author = authorList.filter(x => x?.write).map(x => x.url);
  const recipients = recipientLists.flat().filter(x => x?.read).map(x => x.url);
  return endpoints([...author, ...recipients, ...defaults], 'relay', 128).slice(0, limit);
}

function normalizeMode(spec) {
  if (spec === 'read') return { read: true, write: false };
  if (spec === 'write') return { read: false, write: true };
  if (spec === 'both') return { read: true, write: true };
  if (spec && typeof spec === 'object' && typeof spec.read === 'boolean' && typeof spec.write === 'boolean') {
    if (!spec.read && !spec.write) throw new TypeError('Relay mode must enable read or write');
    return { read: spec.read, write: spec.write };
  }
  throw new TypeError('Invalid relay mode; expected "read", "write", "both", or { read, write }');
}

/**
 * Plan a safe NIP-65 kind 10002 replacement: preserves non-'r' tags and content, canonicalizes
 * endpoints, prevents emptying write relays, and returns dual-broadcast targets (old + new write relays).
 */
export function planRelayListUpdate(
  currentEvent = null,
  { add = [], remove = [], setMode = {}, created_at = Math.floor(Date.now() / 1000) } = {}
) {
  let prior = null;
  if (currentEvent != null) {
    prior = verifiedCopy(currentEvent);
    if (prior.kind !== 10002) throw new TypeError('Current relay list must be a signed kind 10002 event');
  }
  if (!Array.isArray(add) || !Array.isArray(remove)) throw new TypeError('add and remove must be arrays');
  if (!setMode || typeof setMode !== 'object' || Array.isArray(setMode)) {
    throw new TypeError('setMode must be an object mapping relay URLs to modes');
  }

  const existingRecords = prior ? relayList(prior, { verify: false }) : [];
  const oldWriteRelays = existingRecords.filter(r => r.write).map(r => r.url);
  const map = new Map(existingRecords.map(r => [r.url, { url: r.url, read: r.read, write: r.write }]));
  const removed = [];
  const added = [];

  for (const raw of remove) {
    const url = endpoint(raw);
    if (map.delete(url)) removed.push(url);
  }

  for (const item of add) {
    if (typeof item === 'string') {
      const url = endpoint(item);
      if (!map.has(url)) added.push(url);
      map.set(url, { url, read: true, write: true });
    } else if (item && typeof item === 'object' && typeof item.url === 'string') {
      const url = endpoint(item.url);
      const read = item.read !== false;
      const write = item.write !== false;
      if (!read && !write) throw new TypeError('Added relay must enable read or write');
      if (!map.has(url)) added.push(url);
      map.set(url, { url, read, write });
    } else {
      throw new TypeError('Invalid relay entry in add');
    }
  }

  for (const [rawUrl, modeSpec] of Object.entries(setMode)) {
    const url = endpoint(rawUrl);
    const mode = normalizeMode(modeSpec);
    if (!map.has(url)) added.push(url);
    map.set(url, { url, ...mode });
  }

  const records = [...map.values()].sort((a, b) => a.url.localeCompare(b.url));
  const newWriteRelays = records.filter(r => r.write).map(r => r.url);
  if (!newWriteRelays.length) {
    throw new Error('Relay list update must keep at least one write relay');
  }

  const rTags = records.map(r => {
    if (r.read && r.write) return ['r', r.url];
    return ['r', r.url, r.read ? 'read' : 'write'];
  });
  const preservedTags = prior ? prior.tags.filter(t => t[0] !== 'r').map(t => [...t]) : [];
  const template = eventTemplate({
    kind: 10002,
    content: prior?.content ?? '',
    tags: [...rTags, ...preservedTags],
    created_at,
  });

  const broadcastRelays = endpoints([...oldWriteRelays, ...newWriteRelays], 'relay', 128);
  return { template, records, broadcastRelays, added, removed };
}

export async function relayInfo(url, { fetcher = defaultFetch, signal, timeoutMs = 10000, maxBytes = 256 * 1024, publicHost = false } = {}) {
  const target = endpoint(url, 'relay', { publicHost });
  const http = new URL(target);
  http.protocol = 'https:';
  const result = await boundedFetch(
    http.href,
    { headers: { Accept: 'application/nostr+json' } },
    { fetcher, signal, timeoutMs, maxBytes, read: 'json' }
  );
  if (!result.ok) throw new Error(`NIP-11 HTTP ${result.status}`);
  const body = result.json;
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('Bad NIP-11 response');
  return body;
}

