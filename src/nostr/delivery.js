import { endpoint, endpoints } from '../core/urls.js';
import { verifiedCopy } from './history.js';
import { classifyEventStorage } from '../anchor/kinds.js';
import { isVerifiedReceipt } from './receipts.js';

const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const nowSeconds = () => Math.floor(Date.now() / 1000);
function bounded(values, max, label) {
  if (!Array.isArray(values) || values.length > max) throw new RangeError(`Expected at most ${max} ${label}`);
  return values;
}
function routingEvent(input) {
  // Bound wire inputs before copying or signature verification (same scale as donor router).
  if (!input || typeof input.content !== 'string' || input.content.length > 1048576 || !Array.isArray(input.tags) || input.tags.length > 4096) throw new RangeError('Routing event exceeds input bounds');
  let units = input.content.length;
  for (const tag of input.tags) {
    if (!Array.isArray(tag) || tag.length > 64) throw new RangeError('Routing tag exceeds input bounds');
    for (const value of tag) {
      if (typeof value !== 'string' || value.length > 65536 || (units += value.length) > 2097152) throw new RangeError('Routing event exceeds input bounds');
    }
  }
  const event = verifiedCopy(input);
  if (new TextEncoder().encode(JSON.stringify(['EVENT', event])).length > 2097152) throw new RangeError('Routing frame exceeds byte bound');
  return event;
}
function newestLists(events, now) {
  const lists = new Map();
  for (const input of bounded(events, 256, 'signed lists')) {
    let e; try { e = routingEvent(input); } catch { continue; }
    if (![10002, 10050].includes(e.kind) || e.created_at > now + 60) continue;
    const key = `${e.kind}:${e.pubkey}`, old = lists.get(key);
    if (!old || e.created_at > old.created_at || (e.created_at === old.created_at && e.id < old.id)) lists.set(key, e);
  }
  return lists;
}
function listed(event, mode) {
  const urls = [];
  for (const t of event?.tags ?? []) {
    if (event.kind === 10050 ? t[0] !== 'relay' : t[0] !== 'r' || (t[2] !== undefined && t[2] !== mode)) continue;
    try { const url = endpoint(t[1]); if (!urls.includes(url)) urls.push(url); } catch { /* Ignore malformed relay hints. */ }
  }
  return urls;
}
function pow(id) {
  let count = 0;
  for (const c of id) { const n = Number.parseInt(c, 16); if (n === 0) count += 4; else return count + Math.clz32(n) - 28; }
  return count;
}
function policyRows(rows, now, ttl) {
  const records = new Map();
  for (const r of bounded(rows, 256, 'relay policy observations')) {
    if (!r || !Number.isSafeInteger(r.observedAt) || r.observedAt < now - ttl || r.observedAt > now + 60 || !r.document || typeof r.document !== 'object' || Array.isArray(r.document)) continue;
    let url; try { url = endpoint(r.relay); } catch { continue; }
    const prior = records.get(url);
    if (!prior || prior.observedAt < r.observedAt) records.set(url, { observedAt: r.observedAt, limitation: r.document.limitation ?? {} });
    else if (prior.observedAt === r.observedAt) {
      // Conflicting same-time metadata cannot relax an already observed restriction.
      const a = prior.limitation, b = r.document.limitation ?? {}, merged = {};
      for (const k of ['max_message_length', 'max_content_length', 'max_event_tags']) {
        const v = [a[k], b[k]].filter(n => Number.isSafeInteger(n) && n >= 0); if (v.length) merged[k] = Math.min(...v);
      }
      const p = [a.min_pow_difficulty, b.min_pow_difficulty].filter(n => Number.isSafeInteger(n) && n >= 0);
      if (p.length) merged.min_pow_difficulty = Math.max(...p);
      for (const k of ['auth_required', 'payment_required', 'restricted_writes']) merged[k] = a[k] === true || b[k] === true;
      records.set(url, { observedAt: r.observedAt, limitation: merged });
    }
  }
  return records;
}
/** Offline, event-specific delivery planning. No transport, discovery, auth or publication. */
export function planRelayDelivery(input, {
  signedLists = [], pinned = [], defaults = [], allowedRelays, entitledRelays = [],
  relayPolicies = [], now = nowSeconds(), policyTTL = 21600, redundancy = 2,
  maxCandidates = 32, visibility = 'public', authPubkey, authAvailable = false,
} = {}) {
  const e = routingEvent(input);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(policyTTL) || policyTTL < 0) throw new RangeError('Invalid policy observation time');
  if (!Number.isInteger(redundancy) || redundancy < 1 || redundancy > 8 || !Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 64) throw new RangeError('Invalid delivery limits');
  if (!['public', 'private'].includes(visibility) || (authPubkey !== undefined && !hex(authPubkey)) || typeof authAvailable !== 'boolean') throw new TypeError('Invalid visibility or authentication capability');
  if ([22242, 24242, 27235].includes(e.kind)) throw new Error('Transport auth event is not publishable');
  const protectedEvent = e.tags.some(t => t[0] === '-');
  if (protectedEvent && (!authAvailable || authPubkey !== e.pubkey)) throw new Error('Protected event requires approved author authentication capability');
  const recipients = [...new Set(e.tags.filter(t => t[0] === 'p' && hex(t[1])).map(t => t[1]))];
  if (recipients.length > 16) throw new RangeError('Recipient limit exceeded');
  const allowed = allowedRelays === undefined ? null : new Set(endpoints(allowedRelays, 'relay', 128));
  const entitlement = new Set(endpoints(entitledRelays, 'relay', 128));
  const pins = endpoints(pinned, 'relay', 128), seeds = endpoints(defaults, 'relay', 128);
  const safeHint = url => {
    const host = new URL(url).hostname.toLowerCase();
    // Explicitly approved endpoints may be local. Unapproved hints must be DNS names;
    // the caller still owns DNS/egress policy before any network access.
    return allowed?.has(url) || pins.includes(url) || seeds.includes(url) ||
      (host.includes('.') && !host.includes(':') && !/^\d+(?:\.\d+){3}$/.test(host) && !/\.(?:localhost|local|internal)$/.test(host));
  };
  const filter = urls => [...new Set(urls)].filter(url => (!allowed || allowed.has(url)) && safeHint(url));
  const lists = newestLists(signedLists, now), policies = policyRows(relayPolicies, now, policyTTL);
  let groups;
  if (e.kind === 1059) {
    if (recipients.length !== 1) throw new Error('Gift wrap requires exactly one recipient');
    const urls = filter(listed(lists.get(`10050:${recipients[0]}`), 'read'));
    if (!urls.length) throw new Error('Gift wrap requires verified recipient inbox destinations');
    groups = [{ id: `inbox:${recipients[0]}`, urls }];
  } else if (visibility === 'private') {
    if (!allowed?.size) throw new Error('Private delivery requires explicit approved destinations');
    groups = [{ id: 'private', urls: filter([...pins, ...allowed]) }];
  } else {
    groups = [{ id: 'author', urls: filter([...pins, ...listed(lists.get(`10002:${e.pubkey}`), 'write'), ...seeds]) }];
    for (const p of recipients) groups.push({ id: `mention:${p}`, urls: filter(listed(lists.get(`10002:${p}`), 'read')) });
  }
  const frameBytes = new TextEncoder().encode(JSON.stringify(['EVENT', e])).length;
  const excluded = [];
  const planned = groups.map(group => {
    const candidates = [];
    // Inspect every bounded list candidate before applying the selection cap; an early rejected relay must not hide a later viable one.
    for (const relay of group.urls) {
      const record = policies.get(relay), p = record?.limitation ?? {}, reasons = [], warnings = [];
      const over = (key, actual, reason) => { if (Number.isSafeInteger(p[key]) && p[key] >= 0 && actual > p[key]) reasons.push(reason); };
      over('max_message_length', frameBytes, 'frame-size');
      over('max_content_length', [...e.content].length, 'content-size');
      over('max_event_tags', e.tags.length, 'tag-count');
      if (Number.isSafeInteger(p.min_pow_difficulty) && p.min_pow_difficulty > pow(e.id)) reasons.push('pow');
      if (p.auth_required === true && (!authAvailable || !hex(authPubkey))) reasons.push('auth-required');
      if (p.payment_required === true && !entitlement.has(relay)) reasons.push('payment-required');
      if (p.restricted_writes === true) warnings.push('restricted-write-policy-unverified');
      if (!record) warnings.push('metadata-unavailable-or-stale');
      if (reasons.length) excluded.push({ group: group.id, relay, reasons });
      else candidates.push({ relay, requiresAuthentication: protectedEvent || p.auth_required === true, policyObservedAt: record?.observedAt ?? null, warnings });
    }
    const capped = candidates.slice(0, maxCandidates);
    return { id: group.id, required: redundancy, selected: capped.slice(0, redundancy), fallbacks: capped.slice(redundancy), omitted: candidates.length - capped.length,
      status: !group.urls.length && group.id.startsWith('mention:') ? 'recipient-list-missing' : capped.length < redundancy ? 'insufficient-candidates' : 'planned-unverified' };
  });
  return { eventId: e.id, kind: e.kind, storageClass: classifyEventStorage(e.kind), frameBytes, visibility: e.kind === 1059 ? 'private' : visibility, protectedEvent, at: now, groups: planned, excluded };
}
/** Summarize assertions from a trusted writer, not proof of independent retrieval. No sends or retries. */
export function summarizeRelayDelivery(plan, receipts = []) {
  if (!plan || !hex(plan.eventId) || !Array.isArray(plan.groups) || !plan.groups.length || plan.groups.length > 17 || classifyEventStorage(plan.kind) !== plan.storageClass) throw new TypeError('Invalid delivery plan');
  bounded(receipts, 2048, 'delivery receipts');
  const ephemeral = plan.storageClass === 'ephemeral', groups = [];
  for (const g of plan.groups) {
    if (!g || typeof g.id !== 'string' || !Number.isInteger(g.required) || g.required < 1 || g.required > 8 || !Array.isArray(g.selected) || !Array.isArray(g.fallbacks)) throw new TypeError('Invalid delivery group');
    const urls = new Set([...g.selected, ...g.fallbacks].map(r => endpoint(r.relay)));
    const accepted = new Set(), delivered = new Set();
    for (const r of receipts) {
      if (!r || !urls.has(r.relay) || r.eventId !== plan.eventId || r.accepted !== true) continue;
      accepted.add(r.relay);
      if (ephemeral || isVerifiedReceipt(r, plan.eventId, r.relay)) delivered.add(r.relay);
    }
    groups.push({ id: g.id, required: g.required, accepted: [...accepted], delivered: [...delivered], status: delivered.size >= g.required ? (ephemeral ? 'accepted-ephemeral' : 'verified') : accepted.size ? 'accepted-incomplete' : 'not-delivered' });
  }
  const complete = groups.every(g => g.delivered.length >= g.required);
  return { eventId: plan.eventId, status: complete ? (ephemeral ? 'accepted-ephemeral' : 'verified') : 'partial-or-failed', groups };
}
