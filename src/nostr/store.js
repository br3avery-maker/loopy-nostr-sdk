import { isHex, classifyEventStorage } from '../core/guards.js';
import { eventTemplate } from './events.js';
import { verifiedCopy, eventIdentity } from './history.js';
import { matchesFilter } from './filter.js';

const ADDRESS_RE = /^(\d{1,5}):([0-9a-f]{64}):(.*)$/;

function parseAddress(addr) {
  if (typeof addr !== 'string') return null;
  const m = ADDRESS_RE.exec(addr);
  if (!m) return null;
  const kind = Number(m[1]);
  if (!Number.isSafeInteger(kind) || kind < 0 || kind > 65535) return null;
  return { kind, pubkey: m[2], identifier: m[3], raw: addr };
}

/** Build an unsigned NIP-09 deletion request event template (kind 5). */
export function deletionTemplate({ ids = [], addresses = [], reason = '', created_at = Math.floor(Date.now() / 1000) } = {}) {
  if (!Array.isArray(ids) || !Array.isArray(addresses)) {
    throw new TypeError('ids and addresses must be arrays');
  }
  const uniqueIds = [];
  for (const id of ids) {
    if (!isHex(id, 64)) throw new TypeError('Invalid target event ID for NIP-09 deletion');
    if (!uniqueIds.includes(id)) uniqueIds.push(id);
  }
  const uniqueAddrs = [];
  for (const addr of addresses) {
    const parsed = parseAddress(addr);
    if (!parsed) throw new TypeError('Invalid target address for NIP-09 deletion');
    if (!uniqueAddrs.includes(parsed.raw)) uniqueAddrs.push(parsed.raw);
  }
  if (!uniqueIds.length && !uniqueAddrs.length) {
    throw new TypeError('At least one event ID or address is required for NIP-09 deletion');
  }
  const tags = [...uniqueIds.map(id => ['e', id]), ...uniqueAddrs.map(a => ['a', a])];
  return eventTemplate({ kind: 5, content: String(reason ?? ''), tags, created_at });
}

function assertStorage(storage) {
  if (
    !storage ||
    typeof storage.get !== 'function' ||
    typeof storage.set !== 'function' ||
    typeof storage.delete !== 'function' ||
    typeof storage.keys !== 'function'
  ) {
    throw new TypeError('EventStore requires a StorageAdapter with get/set/delete/keys');
  }
}

function uncheckedIdentity(ev) {
  const cls = classifyEventStorage(ev.kind);
  if (cls === 'regular') return ev.id;
  if (cls === 'replaceable') return `${ev.kind}:${ev.pubkey}:`;
  if (cls === 'addressable') {
    const tags = Array.isArray(ev.tags) ? ev.tags : [];
    const d = tags.find(t => Array.isArray(t) && t[0] === 'd')?.[1] ?? '';
    return `${ev.kind}:${ev.pubkey}:${d}`;
  }
  return ev.id;
}

/**
 * StorageAdapter-backed NIP-01 verified event store honoring regular, replaceable, and
 * addressable replacement semantics (newest created_at, lowest lexicographic id tie-break),
 * ephemeral rejection, and author-verified NIP-09 deletion tombstones.
 */
export function createEventStore(storage) {
  assertStorage(storage);

  const EVT_PREFIX = 'evt:';
  const IDX_PREFIX = 'idx:';
  const DEL_ID_PREFIX = 'del:';
  const DEL_ADDR_PREFIX = 'deladdr:';

  function identityFor(ev, verify) {
    return verify ? eventIdentity(ev) : uncheckedIdentity(ev);
  }

  async function isTombstoned(ev, verify = false) {
    const idTomb = await storage.get(DEL_ID_PREFIX + ev.id);
    if (idTomb && idTomb.deletedBy === ev.pubkey) return true;
    const cls = classifyEventStorage(ev.kind);
    if (cls === 'addressable' || cls === 'replaceable') {
      const identity = identityFor(ev, verify);
      const addrTomb = await storage.get(DEL_ADDR_PREFIX + identity);
      if (addrTomb && addrTomb.deletedBy === ev.pubkey && ev.created_at <= addrTomb.deletedAt) {
        return true;
      }
    }
    return false;
  }

  return {
    async put(input, { verify = true } = {}) {
      const ev = verify ? verifiedCopy(input) : structuredClone(input);
      if (
        !ev ||
        !isHex(ev.id, 64) ||
        !isHex(ev.pubkey, 64) ||
        !Number.isSafeInteger(ev.kind) ||
        !Number.isSafeInteger(ev.created_at) ||
        !Array.isArray(ev.tags)
      ) {
        throw new TypeError('Valid signed Nostr event required');
      }
      const cls = classifyEventStorage(ev.kind);
      if (cls === 'ephemeral') {
        return { stored: false, reason: 'ephemeral', id: ev.id };
      }
      if (await isTombstoned(ev, verify)) {
        return { stored: false, reason: 'deleted', id: ev.id };
      }
      if (cls === 'regular') {
        const existing = await storage.get(EVT_PREFIX + ev.id);
        if (existing) return { stored: false, reason: 'duplicate', id: ev.id };
        await storage.set(EVT_PREFIX + ev.id, ev);
        return { stored: true, id: ev.id, replacedId: null };
      }
      const identity = identityFor(ev, verify);
      const current = await storage.get(IDX_PREFIX + identity);
      if (current) {
        if (current.id === ev.id) return { stored: false, reason: 'duplicate', id: ev.id };
        if (current.created_at > ev.created_at || (current.created_at === ev.created_at && current.id < ev.id)) {
          return { stored: false, reason: 'superseded', id: ev.id, winnerId: current.id };
        }
        await storage.delete(EVT_PREFIX + current.id);
      }
      await storage.set(EVT_PREFIX + ev.id, ev);
      await storage.set(IDX_PREFIX + identity, { id: ev.id, created_at: ev.created_at });
      return { stored: true, id: ev.id, replacedId: current?.id ?? null };
    },

    async get(id) {
      if (!isHex(id, 64)) throw new TypeError('Event ID must be 64-char lowercase hex');
      const ev = await storage.get(EVT_PREFIX + id);
      if (!ev) return null;
      if (await isTombstoned(ev, false)) return null;
      return ev;
    },

    async query(filter = {}) {
      if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
        throw new TypeError('Expected one Nostr filter object');
      }
      if (Object.hasOwn(filter, 'limit') && (!Number.isSafeInteger(filter.limit) || filter.limit < 0)) {
        throw new RangeError('Filter limit must be a nonnegative integer');
      }
      const allKeys = await storage.keys(EVT_PREFIX);
      const matched = [];
      for (const key of allKeys) {
        if (!key.startsWith(EVT_PREFIX)) continue;
        const ev = await storage.get(key);
        if (!ev) continue;
        if (await isTombstoned(ev, false)) continue;
        if (matchesFilter(ev, filter)) matched.push(ev);
      }
      matched.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
      return Object.hasOwn(filter, 'limit') ? matched.slice(0, filter.limit) : matched;
    },

    async applyDeletion(deletionEvent, { verify = true, retainArchive = false } = {}) {
      const ev = verify ? verifiedCopy(deletionEvent) : structuredClone(deletionEvent);
      if (!ev || ev.kind !== 5) throw new TypeError('NIP-09 deletion requires a kind 5 event');

      const deletedIds = [];
      const deletedAddresses = [];
      const ignored = [];

      for (const tag of ev.tags || []) {
        if (tag[0] === 'e' && isHex(tag[1], 64)) {
          const targetId = tag[1];
          const existing = await storage.get(EVT_PREFIX + targetId);
          if (existing && existing.pubkey !== ev.pubkey) {
            ignored.push({ type: 'e', target: targetId, reason: 'author-mismatch' });
            continue;
          }
          await storage.set(DEL_ID_PREFIX + targetId, {
            deletedBy: ev.pubkey,
            deletedAt: ev.created_at,
            deletionId: ev.id,
          });
          if (!retainArchive && existing) {
            await storage.delete(EVT_PREFIX + targetId);
            const cls = classifyEventStorage(existing.kind);
            if (cls === 'replaceable' || cls === 'addressable') {
              const identity = uncheckedIdentity(existing);
              const idx = await storage.get(IDX_PREFIX + identity);
              if (idx?.id === targetId) await storage.delete(IDX_PREFIX + identity);
            }
          }
          if (!deletedIds.includes(targetId)) deletedIds.push(targetId);
        } else if (tag[0] === 'a' && typeof tag[1] === 'string') {
          const parsed = parseAddress(tag[1]);
          if (!parsed) {
            ignored.push({ type: 'a', target: tag[1], reason: 'invalid-address' });
            continue;
          }
          if (parsed.pubkey !== ev.pubkey) {
            ignored.push({ type: 'a', target: parsed.raw, reason: 'author-mismatch' });
            continue;
          }
          const priorTomb = await storage.get(DEL_ADDR_PREFIX + parsed.raw);
          const deletedAt = Math.max(priorTomb?.deletedAt ?? 0, ev.created_at);
          await storage.set(DEL_ADDR_PREFIX + parsed.raw, {
            deletedBy: ev.pubkey,
            deletedAt,
            deletionId: ev.id,
          });
          if (!retainArchive) {
            const idx = await storage.get(IDX_PREFIX + parsed.raw);
            if (idx && idx.created_at <= deletedAt) {
              await storage.delete(EVT_PREFIX + idx.id);
              await storage.delete(IDX_PREFIX + parsed.raw);
            }
          }
          if (!deletedAddresses.includes(parsed.raw)) deletedAddresses.push(parsed.raw);
        }
      }

      // Store the deletion request event itself for provenance unless already present.
      const existingDel = await storage.get(EVT_PREFIX + ev.id);
      if (!existingDel) await storage.set(EVT_PREFIX + ev.id, ev);

      return { deletionId: ev.id, deletedIds, deletedAddresses, ignored };
    },

    async keys() {
      const allKeys = await storage.keys(EVT_PREFIX);
      const liveIds = [];
      for (const key of allKeys) {
        if (!key.startsWith(EVT_PREFIX)) continue;
        const ev = await storage.get(key);
        if (ev && !(await isTombstoned(ev))) liveIds.push(ev.id);
      }
      return liveIds.sort();
    },

    async count() {
      return (await this.keys()).length;
    },

    async close() {
      if (typeof storage.close === 'function') await storage.close();
    },
  };
}
