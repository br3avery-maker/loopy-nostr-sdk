import { endpoint, endpoints } from '../core/urls.js';
import { verifiedCopy } from './history.js';
import { classifyEventStorage } from '../anchor/kinds.js';
import { isVerifiedReceipt } from './receipts.js';
import { publishRelay } from './relay-transport.js';

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
/** Fresh signed NIP-66 observations are advisory; local transport evidence is principal-scoped. */
function monitorEvidence(events, now, ttl) {
  const winners = new Map();
  for (const raw of bounded(events,256,'monitor reports')) {
    let e, relay; try { e=routingEvent(raw); const d=e.tags.filter(t=>t[0]==='d'); if(e.kind!==30166||d.length!==1||e.created_at<now-ttl||e.created_at>now+60)continue; relay=endpoint(d[0][1]); } catch { continue; }
    const key=JSON.stringify([relay,e.pubkey]), old=winners.get(key);
    if(!old||e.created_at>old.event.created_at||(e.created_at===old.event.created_at&&e.id<old.event.id))winners.set(key,{relay,event:e});
  }
  return [...winners.values()];
}
const observationCodes=new Set(['accepted','unsupported-kind','rate-limited','network','timeout','rejected','policy','auth-required','payment-required','size']);
function transportEvidence(rows, now, ttl, principal) {
  return bounded(rows,2048,'local transport observations').flatMap(r=>{
    try { if(!r||r.principal!==principal||!hex(r.eventId)||!hex(r.author)||!Number.isInteger(r.kind)||r.kind<0||r.kind>65535||!Number.isSafeInteger(r.at)||r.at<now-ttl||r.at>now+60||typeof r.accepted!=='boolean'||!observationCodes.has(r.code))return [];
      return [{relay:endpoint(r.relay),eventId:r.eventId,author:r.author,kind:r.kind,at:r.at,code:r.code,accepted:r.accepted,readback:r.accepted&&r.readback===true}]; } catch { return []; }
  });
}
/** Offline, event-specific delivery planning. No transport, discovery, auth or publication. */
export function planRelayDelivery(input, {
  signedLists = [], pinned = [], defaults = [], allowedRelays, entitledRelays = [],
  relayPolicies = [], monitorEvents = [], observations = [], now = nowSeconds(), policyTTL = 21600, monitorTTL = 3600, observationTTL = 3600, redundancy = 2,
  maxCandidates = 32, visibility = 'public', authPubkey, authAvailable = false,
} = {}) {
  const e = routingEvent(input);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(policyTTL) || policyTTL < 0) throw new RangeError('Invalid policy observation time');
  if (![monitorTTL,observationTTL].every(t=>Number.isSafeInteger(t)&&t>=0&&t<=86400)) throw new RangeError('Invalid evidence TTL');
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
  const monitors=monitorEvidence(monitorEvents,now,monitorTTL), outcomes=transportEvidence(observations,now,observationTTL,authPubkey??'anonymous');
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
    groups = [{ id: 'author', urls: filter([...pins, ...listed(lists.get(`10002:${e.pubkey}`), 'write'), ...seeds]), preferred: [...pins,...listed(lists.get(`10002:${e.pubkey}`), 'write')] }];
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
      const local=outcomes.filter(o=>o.relay===relay&&o.author===e.pubkey&&o.kind===e.kind);
      const latest=local.filter(o=>o.eventId===e.id).sort((a,b)=>b.at-a.at||Number(b.accepted)-Number(a.accepted))[0];
      if(latest&&!latest.accepted&&now-latest.at<(latest.code==='rate-limited'?60:['network','timeout'].includes(latest.code)?15:300))reasons.push('recent-'+latest.code);
      if(local.some(o=>!o.accepted&&o.code==='unsupported-kind'&&now-o.at<300))reasons.push('observed-unsupported-kind');
      const hints=monitors.filter(m=>m.relay===relay).flatMap(({event})=>{
        const tags=event.tags.filter(t=>t[0]==='k'&&typeof t[1]==='string'&&/^!?[0-9]{1,5}$/.test(t[1])&&Number(t[1].replace('!',''))===e.kind);
        return tags.length?[{eventId:event.id,source:event.pubkey,accepted:!tags.some(t=>t[1].startsWith('!'))}]:[];
      });
      const positive=hints.filter(h=>h.accepted).length,negative=hints.length-positive,priorReadback=local.some(o=>o.readback);
      if(negative)warnings.push(positive?'monitor-conflict':'monitor-reports-rejection');
      if (reasons.length) excluded.push({ group: group.id, relay, reasons });
      else candidates.push({ relay, requiresAuthentication: protectedEvent || p.auth_required === true, policyObservedAt: record?.observedAt ?? null, warnings, evidence:{monitorHints:hints,priorReadback}, rank:[Number(group.preferred?.includes(relay)??false),Number(priorReadback),negative?0:Math.min(2,positive)] });
    }
    candidates.sort((a,b)=>b.rank[0]-a.rank[0]||b.rank[1]-a.rank[1]||b.rank[2]-a.rank[2]);
    const capped = candidates.slice(0, maxCandidates).map(({rank,...row})=>row);
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

/** Execute a freshly computed delivery plan, with explicit destination approval and bounded fallback. */
export async function executeRelayDelivery(input, options={}) {
  const {allowedRelays,authSigner,authPubkey,signal,Socket,timeoutMs=10000,maxAttempts=32,...routing}=options;
  if(!Array.isArray(allowedRelays)||!allowedRelays.length)throw new TypeError('Explicit approved relay destinations required');
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>64||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new RangeError('Invalid execution bounds');
  if((authSigner!==undefined&&(typeof authSigner?.signEvent!=='function'||!hex(authPubkey)))||(authSigner===undefined&&authPubkey!==undefined))throw new TypeError('Invalid authorized signer identity');
  const event=routingEvent(input), plan=planRelayDelivery(event,{...routing,allowedRelays,authPubkey,authAvailable:!!authSigner});
  const receipts=[], attempts=[], observed=[], seen=new Set(), cancelled=()=>{if(signal?.aborted)throw new Error('Relay delivery cancelled');};
  cancelled();
  for(const group of plan.groups){
    for(const candidate of [...group.selected,...group.fallbacks]){
      cancelled();
      const groupStatus=summarizeRelayDelivery(plan,receipts).groups.find(g=>g.id===group.id);
      if(groupStatus.delivered.length>=group.required||attempts.length>=maxAttempts)break;
      if(seen.has(candidate.relay))continue;
      seen.add(candidate.relay);
      try{
        const receipt=await publishRelay(candidate.relay,event,{Socket,timeoutMs,signal,authSigner,authPubkey,requireAuthentication:candidate.requiresAuthentication,acceptEphemeral:plan.storageClass==='ephemeral'});
        receipts.push(receipt);attempts.push({relay:candidate.relay,status:'accepted'});
        observed.push({relay:candidate.relay,eventId:event.id,author:event.pubkey,kind:event.kind,principal:authPubkey??'anonymous',at:nowSeconds(),code:'accepted',accepted:true,readback:receipt.readback});
      }catch(error){cancelled();const accepted=error?.accepted===true,code=observationCodes.has(error?.code)?error.code:'rejected';
        attempts.push({relay:candidate.relay,status:accepted?'accepted-unverified':'failed',code});
        if(accepted)receipts.push({relay:candidate.relay,eventId:event.id,accepted:true,readback:false});
        observed.push({relay:candidate.relay,eventId:event.id,author:event.pubkey,kind:event.kind,principal:authPubkey??'anonymous',at:nowSeconds(),code,accepted,readback:false});
      }
    }
  }
  cancelled();
  return {plan,receipts,attempts,observations:observed,summary:summarizeRelayDelivery(plan,receipts)};
}
