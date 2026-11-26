import { endpoint } from '../core/urls.js';
import { isHex, assertSafeInt } from '../core/guards.js';
import { verifiedCopy } from './history.js';

const nowSeconds = () => Math.floor(Date.now() / 1000);

const OBSERVATION_CODES = new Set([
  'accepted',
  'unsupported-kind',
  'rate-limited',
  'network',
  'timeout',
  'rejected',
  'policy',
  'auth-required',
  'payment-required',
  'size',
  'pow',
  'invalid',
  'duplicate',
  'readback-missing',
]);

function assertStorage(storage) {
  if (
    !storage ||
    typeof storage.get !== 'function' ||
    typeof storage.set !== 'function' ||
    typeof storage.delete !== 'function' ||
    typeof storage.keys !== 'function'
  ) {
    throw new TypeError('Valid StorageAdapter required');
  }
}

/**
 * Durable, TTL-bounded relay health cache backed by any StorageAdapter.
 * Stores local transport observations, NIP-11 relay policy snapshots, and verified NIP-66
 * kind 30166 monitor reports in the exact shapes consumed by `planRelayDelivery`.
 */
export function createRelayHealthCache(
  storage,
  {
    prefix = 'relay-health:',
    observationTtl = 3600,
    policyTtl = 21600,
    monitorTtl = 3600,
    maxObservations = 500,
    maxPolicies = 256,
    maxMonitorEvents = 256,
  } = {}
) {
  assertStorage(storage);
  if (typeof prefix !== 'string' || prefix.length > 128) throw new TypeError('Invalid cache prefix');
  assertSafeInt(observationTtl, { min: 1, max: 86400, label: 'observationTtl' });
  assertSafeInt(policyTtl, { min: 1, max: 604800, label: 'policyTtl' });
  assertSafeInt(monitorTtl, { min: 1, max: 86400, label: 'monitorTtl' });
  assertSafeInt(maxObservations, { min: 1, max: 2048, label: 'maxObservations' });
  assertSafeInt(maxPolicies, { min: 1, max: 256, label: 'maxPolicies' });
  assertSafeInt(maxMonitorEvents, { min: 1, max: 256, label: 'maxMonitorEvents' });

  const OBS_KEY = prefix + 'observations';
  const POL_KEY = prefix + 'policies';
  const MON_KEY = prefix + 'monitors';

  const sanitizeObservation = raw => {
    if (!raw || typeof raw !== 'object') return null;
    if (
      typeof raw.principal !== 'string' ||
      !raw.principal ||
      !isHex(raw.eventId, 64) ||
      !isHex(raw.author, 64) ||
      !Number.isInteger(raw.kind) ||
      raw.kind < 0 ||
      raw.kind > 65535 ||
      !Number.isSafeInteger(raw.at) ||
      raw.at < 0 ||
      typeof raw.accepted !== 'boolean' ||
      !OBSERVATION_CODES.has(raw.code)
    ) {
      return null;
    }
    let relay;
    try {
      relay = endpoint(raw.relay);
    } catch {
      return null;
    }
    return {
      relay,
      eventId: raw.eventId,
      author: raw.author,
      kind: raw.kind,
      principal: raw.principal,
      at: raw.at,
      code: raw.code,
      accepted: raw.accepted,
      readback: raw.accepted && raw.readback === true,
    };
  };

  async function recordObservations(observations, { now = nowSeconds() } = {}) {
    if (!Array.isArray(observations)) throw new TypeError('observations array required');
    assertSafeInt(now, { min: 0, label: 'now' });
    const existing = Array.isArray(await storage.get(OBS_KEY)) ? await storage.get(OBS_KEY) : [];
    const merged = [...existing];
    let added = 0;
    for (const raw of observations) {
      const clean = sanitizeObservation(raw);
      if (!clean) continue;
      if (clean.at < now - observationTtl || clean.at > now + 60) continue;
      merged.push(clean);
      added += 1;
    }
    const fresh = merged
      .map(sanitizeObservation)
      .filter(Boolean)
      .filter(r => r.at >= now - observationTtl && r.at <= now + 60)
      .sort((a, b) => b.at - a.at)
      .slice(0, maxObservations);
    await storage.set(OBS_KEY, fresh);
    return { added, stored: fresh.length };
  }

  async function getObservations({ now = nowSeconds(), relay, principal } = {}) {
    assertSafeInt(now, { min: 0, label: 'now' });
    const targetRelay = relay === undefined ? null : endpoint(relay);
    const raw = await storage.get(OBS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw
      .map(sanitizeObservation)
      .filter(Boolean)
      .filter(r => r.at >= now - observationTtl && r.at <= now + 60)
      .filter(r => (!targetRelay || r.relay === targetRelay) && (!principal || r.principal === principal));
  }

  async function savePolicy(relay, document, { observedAt = nowSeconds(), now = observedAt } = {}) {
    const url = endpoint(relay);
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new TypeError('NIP-11 policy document object required');
    }
    assertSafeInt(observedAt, { min: 0, label: 'observedAt' });
    assertSafeInt(now, { min: 0, label: 'now' });
    if (observedAt < now - policyTtl || observedAt > now + 60) {
      throw new RangeError('NIP-11 policy observedAt outside freshness window');
    }
    const raw = await storage.get(POL_KEY);
    const map = new Map();
    if (Array.isArray(raw)) {
      for (const row of raw) {
        if (!row || !Number.isSafeInteger(row.observedAt) || row.observedAt < now - policyTtl || row.observedAt > now + 60) continue;
        try {
          map.set(endpoint(row.relay), { relay: endpoint(row.relay), observedAt: row.observedAt, document: structuredClone(row.document) });
        } catch {}
      }
    }
    const prior = map.get(url);
    if (!prior || prior.observedAt <= observedAt) {
      map.set(url, { relay: url, observedAt, document: structuredClone(document) });
    }
    const entries = [...map.values()]
      .sort((a, b) => b.observedAt - a.observedAt)
      .slice(0, maxPolicies);
    await storage.set(POL_KEY, entries);
    return map.get(url);
  }

  async function getPolicies({ now = nowSeconds(), relay } = {}) {
    assertSafeInt(now, { min: 0, label: 'now' });
    const targetRelay = relay === undefined ? null : endpoint(relay);
    const raw = await storage.get(POL_KEY);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(r => r && Number.isSafeInteger(r.observedAt) && r.observedAt >= now - policyTtl && r.observedAt <= now + 60)
      .filter(r => {
        try {
          return !targetRelay || endpoint(r.relay) === targetRelay;
        } catch {
          return false;
        }
      })
      .map(r => ({ relay: endpoint(r.relay), observedAt: r.observedAt, document: structuredClone(r.document) }));
  }

  async function saveMonitorEvent(event, { now = nowSeconds() } = {}) {
    assertSafeInt(now, { min: 0, label: 'now' });
    const verified = verifiedCopy(event);
    const dTags = verified.tags.filter(t => t[0] === 'd');
    if (verified.kind !== 30166 || dTags.length !== 1) {
      throw new TypeError('Verified NIP-66 kind 30166 monitor event with single d tag required');
    }
    const relay = endpoint(dTags[0][1]);
    if (verified.created_at < now - monitorTtl || verified.created_at > now + 60) {
      throw new RangeError('NIP-66 monitor event outside freshness window');
    }
    const raw = await storage.get(MON_KEY);
    const winners = new Map();
    const ingest = candidate => {
      try {
        const v = verifiedCopy(candidate);
        const dt = v.tags.filter(t => t[0] === 'd');
        if (v.kind !== 30166 || dt.length !== 1 || v.created_at < now - monitorTtl || v.created_at > now + 60) return;
        const rUrl = endpoint(dt[0][1]);
        const key = JSON.stringify([rUrl, v.pubkey]);
        const prev = winners.get(key);
        if (!prev || v.created_at > prev.created_at || (v.created_at === prev.created_at && v.id < prev.id)) {
          winners.set(key, v);
        }
      } catch {}
    };
    if (Array.isArray(raw)) {
      for (const item of raw) ingest(item);
    }
    ingest(verified);
    const entries = [...winners.values()]
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
      .slice(0, maxMonitorEvents);
    await storage.set(MON_KEY, entries);
    return { relay, event: verified, stored: entries.length };
  }

  async function getMonitorEvents({ now = nowSeconds(), relay } = {}) {
    assertSafeInt(now, { min: 0, label: 'now' });
    const targetRelay = relay === undefined ? null : endpoint(relay);
    const raw = await storage.get(MON_KEY);
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      try {
        const v = verifiedCopy(item);
        const dt = v.tags.filter(t => t[0] === 'd');
        if (v.kind !== 30166 || dt.length !== 1 || v.created_at < now - monitorTtl || v.created_at > now + 60) continue;
        const rUrl = endpoint(dt[0][1]);
        if (targetRelay && rUrl !== targetRelay) continue;
        out.push(v);
      } catch {}
    }
    return out;
  }

  async function exportForDelivery({ now = nowSeconds() } = {}) {
    const [observations, relayPolicies, monitorEvents] = await Promise.all([
      getObservations({ now }),
      getPolicies({ now }),
      getMonitorEvents({ now }),
    ]);
    return { observations, relayPolicies, monitorEvents };
  }

  async function clear() {
    await Promise.all([storage.delete(OBS_KEY), storage.delete(POL_KEY), storage.delete(MON_KEY)]);
  }

  return {
    recordObservations,
    getObservations,
    savePolicy,
    getPolicies,
    saveMonitorEvent,
    getMonitorEvents,
    exportForDelivery,
    clear,
  };
}
