/** Portable public-only account recovery & publication receipts, adapted from Nostr Anchor. */
import { assertSignedEvent } from '../nostr/events.js';
import { normalizePubkey } from '../nostr/nip19.js';
import { isForbiddenKey, safeHttpUrl } from '../core/guards.js';
import { endpoint } from '../core/urls.js';

const KEYS = [
  'mode',
  'pubkey',
  'npub',
  'label',
  'connectedAt',
  'connectionDetail',
  'bunkerRelays',
  'remoteSignerPubkey',
  'androidSignerPackage',
  'rememberedPermissions',
];
const SECRET_KEYS = new Set([
  'nsec',
  'secret',
  'privateKey',
  'private_key',
  'bunkerUri',
  'bunkerSecret',
  'connectionSecret',
  'clientSecret',
  'password',
  'passphrase',
  'token',
  'authorization',
  'accessToken',
  'refreshToken',
]);
const SECRET_VALUE = /(?:nsec1[a-z0-9]{20,}|bunker:\/\/\S+|nostrconnect:\/\/\S+|^(?:Nostr|Bearer)\s+\S+)/i;

function stripSecrets(value, depth = 0) {
  if (depth > 12) throw new Error('Backup nested too deeply');
  if (typeof value === 'string') return SECRET_VALUE.test(value) ? undefined : value;
  if (Array.isArray(value)) return value.slice(0, 10000).map(x => stripSecrets(x, depth + 1)).filter(x => x !== undefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 5000)) {
      if (isForbiddenKey(k)) continue;
      if (
        SECRET_KEYS.has(k) ||
        /secret|private.?key|api.?key|mnemonic|seed.?phrase|(?:auth|refresh|access).*token|passphrase|password|bunker.?uri|authorization/i.test(k)
      ) {
        continue;
      }
      const clean = stripSecrets(v, depth + 1);
      if (clean !== undefined) out[k] = clean;
    }
    return out;
  }
  return value;
}

export function sanitizePublicSession(session) {
  if (!session) return null;
  const out = {};
  for (const key of KEYS) {
    if (session[key] !== undefined) {
      const clean = stripSecrets(session[key]);
      if (clean !== undefined) out[key] = clean;
    }
  }
  const pubkey = normalizePubkey(out.pubkey);
  if (!pubkey) throw new TypeError('Public session requires valid pubkey');
  out.pubkey = pubkey;
  if (!['nip07', 'nip46', 'nip55', 'read-only', 'ephemeral-test'].includes(out.mode)) out.mode = 'read-only';
  if (out.mode === 'ephemeral-test') out.mode = 'read-only';
  if (typeof out.connectionDetail === 'string' && /bunker:\/\/|nostrconnect:\/\/|nsec1/i.test(out.connectionDetail)) {
    delete out.connectionDetail;
  }
  return out;
}

export function buildPublicAccountBackup(state, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (!state?.session) throw new TypeError('Public session is required');
  const session = sanitizePublicSession(state.session);
  const rows = {
    profile: state.profile || {},
    relays: state.relays || [],
    blossomServers: state.blossomServers || [],
    follows: state.follows || [],
    publications: state.publications || [],
    preferences: state.preferences || {},
  };
  return { schema: 'nsite-loopy-public-backup/1', exportedAt: now, containsSecrets: false, account: session, records: stripSecrets(rows) };
}

/** Restore only checked published events, never active signer privileges. */
export function restorePublicAccountBackup(input) {
  let backup = input;
  if (typeof input === 'string') {
    try { backup = JSON.parse(input); } catch { throw new Error('Invalid public backup JSON'); }
  }
  if (!backup || typeof backup !== 'object' || backup.schema !== 'nsite-loopy-public-backup/1' || backup.containsSecrets !== false) {
    throw new Error('Invalid public backup schema');
  }
  const session = sanitizePublicSession(backup.account);
  const rec = stripSecrets(backup.records && typeof backup.records === 'object' ? backup.records : {});
  const verified = [];
  const rejected = [];
  for (const item of (Array.isArray(rec.publications) ? rec.publications : []).slice(0, 10000)) {
    if (!item?.currentEvent) {
      rejected.push({ reason: 'missing signed event' });
      continue;
    }
    try {
      assertSignedEvent(item.currentEvent);
      if (item.currentEvent.pubkey !== session.pubkey) throw new Error('author mismatch');
      verified.push(item);
    } catch (e) {
      rejected.push({ reason: e.message });
    }
  }
  return {
    session: { ...session, mode: 'read-only', needsSignerReconnect: true },
    profile: rec.profile && typeof rec.profile === 'object' && !Array.isArray(rec.profile) ? rec.profile : {},
    relays: Array.isArray(rec.relays) ? rec.relays : [],
    blossomServers: Array.isArray(rec.blossomServers) ? rec.blossomServers : [],
    follows: Array.isArray(rec.follows) ? rec.follows : [],
    preferences: rec.preferences && typeof rec.preferences === 'object' && !Array.isArray(rec.preferences) ? rec.preferences : {},
    publications: verified,
    rejectedPublications: rejected,
    signerConnected: false,
  };
}

const STAGE_RANK = { failed: 0, unverified: 1, acknowledged: 2, retrieved: 3 };

export function summarizePublicationReceipts(receipts = []) {
  const list = Array.isArray(receipts) ? receipts : receipts?.relays || receipts?.verified || [];
  const byRelay = new Map();
  const output = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const rawRelay = String(r.relay || '').trim();
    let relay = rawRelay;
    try {
      if (rawRelay) relay = endpoint(rawRelay, 'relay');
    } catch {
      relay = rawRelay;
    }
    const accepted = r.accepted === true || r.acknowledged === true;
    const readback = r.readback === true || r.independentlyRetrieved === true;
    const stage = readback && accepted ? 'retrieved' : accepted ? 'acknowledged' : r.stage === 'failed' ? 'failed' : 'unverified';
    const record = {
      relay,
      stage,
      accepted,
      readback,
      ...(typeof r.eventId === 'string' && r.eventId ? { eventId: r.eventId } : {}),
    };
    if (!relay) {
      output.push(record);
      continue;
    }
    const existing = byRelay.get(relay);
    if (!existing) {
      byRelay.set(relay, record);
      output.push(record);
    } else if (STAGE_RANK[stage] > STAGE_RANK[existing.stage]) {
      Object.assign(existing, record);
    }
  }
  return {
    total: output.length,
    accepted: output.filter(x => x.accepted).length,
    retrieved: output.filter(x => x.readback && x.accepted).length,
    verified: output.some(x => x.readback && x.accepted),
    receipts: output,
  };
}

/** Export signed-event URL references only: not proof of blob availability, MIME, or content hash. */
export function extractEventAssets(event) {
  assertSignedEvent(event);
  const refs = new Set();
  const add = value => {
    const safe = safeHttpUrl(value, { allowHttp: true, maxLength: 4096 });
    if (safe) refs.add(safe);
  };
  for (const t of event.tags) {
    if (t[0] === 'imeta') for (const v of t.slice(1)) if (v.startsWith('url ')) add(v.slice(4));
    if (event.kind === 1063 && t[0] === 'url') add(t[1]);
    if ([31337, 32123, 36787].includes(event.kind) && ['url', 'image'].includes(t[0])) add(t[1]);
  }
  // Anchor's content-addressed inline URL pattern; no fetch or claim of verification.
  for (const match of event.content.matchAll(/https:\/\/[^\s"'<>()]+?\/[0-9a-f]{64}(?:\.[a-zA-Z0-9]{2,5})?(?=$|[\s"'<>()?#])/gi)) {
    add(match[0]);
  }
  return [...refs];
}

export * from './kinds.js';
export * from './relays.js';
