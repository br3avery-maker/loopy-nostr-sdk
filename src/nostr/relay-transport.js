import { endpoint, endpoints } from '../core/urls.js';
import { isHex, classifyEventStorage } from '../core/guards.js';
import { sdkError } from '../core/http.js';
import { assertSignedEvent } from './events.js';
import { verifiedCopy } from './history.js';
import { isVerifiedReceipt } from './receipts.js';
import { matchesFilter } from './filter.js';
import {
  parseWireFrame,
  isAuthRequired,
  isAuthChallengeFrame,
  classifyRelayRefusal,
  validateRelayFilter,
  validateRelayAuthOptions,
  createFrameBudget,
  signRelayAuthChallenge,
} from './wire.js';

/** Finite NIP-01 REQ, EOSE and EVENT handling; bounded against hostile relays and supports optional NIP-42 AUTH. */
export function queryRelay(
  url,
  filter,
  {
    Socket = globalThis.WebSocket,
    timeoutMs = 8000,
    signal,
    verify = true,
    maxEvents = 500,
    maxFrames = 4096,
    maxBytes = 16 * 1024 * 1024,
    authSigner,
    authPubkey,
  } = {}
) {
  url = endpoint(url);
  if (!Socket) throw new Error('WebSocket transport unavailable');
  filter = validateRelayFilter(filter);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new RangeError('Invalid query timeout');
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) throw new RangeError('maxEvents must be a positive integer');
  if (!Number.isSafeInteger(maxFrames) || maxFrames < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1024) {
    throw new RangeError('Invalid query frame or byte limits');
  }
  validateRelayAuthOptions(authSigner, authPubkey);

  const cap = Math.min(maxEvents, filter.limit ?? maxEvents);
  const budget = createFrameBudget({ maxFrames, maxBytes, relay: url, code: 'size-limit' });

  return new Promise((resolve, reject) => {
    const ws = new Socket(url);
    let id = 'loop-' + Math.random().toString(36).slice(2);
    const events = new Map();
    let done = false;
    let open = false;
    let timer;
    let challenge = null;
    let authId = null;
    let authAttempted = false;
    let authPending = false;

    const clean = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try { ws.close(); } catch {}
    };
    const finish = err => {
      if (done) return;
      done = true;
      clean();
      err ? reject(err) : resolve([...events.values()]);
    };
    const send = msg => {
      if (done) return;
      try { ws.send(JSON.stringify(msg)); } catch (cause) {
        finish(sdkError('Relay send failed', { code: 'network', retryable: true, relay: url, cause }));
      }
    };
    const abort = () => finish(sdkError('Relay query cancelled', { code: 'cancelled', retryable: false, relay: url }));
    const tryAuthenticate = () => {
      if (done || !authPending || !challenge) return;
      if (authAttempted || !authSigner) {
        return finish(sdkError('Relay authentication unavailable or refused', { code: 'auth-required', retryable: false, relay: url }));
      }
      authAttempted = true;
      const usedChallenge = challenge;
      Promise.resolve()
        .then(() => {
          if (done) throw sdkError('Relay query cancelled', { code: 'cancelled', retryable: false, relay: url });
          return signRelayAuthChallenge({ challenge: usedChallenge, relay: url, authSigner, authPubkey });
        })
        .then(auth => {
          if (done) return;
          if (challenge !== usedChallenge) {
            return finish(sdkError('Relay AUTH challenge changed', { code: 'auth-required', retryable: true, relay: url }));
          }
          authId = auth.id;
          send(['AUTH', auth]);
        })
        .catch(cause => finish(sdkError('Relay authentication denied or invalid', { code: 'auth-required', retryable: false, relay: url, cause })));
    };

    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(sdkError('Relay EOSE timeout', { code: 'timeout', retryable: true, relay: url })), timeoutMs);

    ws.onopen = () => { open = true; send(['REQ', id, filter]); };
    ws.onerror = () => finish(sdkError('Relay WebSocket error', { code: 'network', retryable: true, relay: url }));
    ws.onclose = () => {
      if (!done) finish(sdkError(open ? 'Relay closed before EOSE' : 'Relay failed to connect', { code: 'network', retryable: true, relay: url }));
    };
    ws.onmessage = ({ data }) => {
      if (done) return;
      const limitErr = budget.consume(data);
      if (limitErr) return finish(limitErr);
      const m = parseWireFrame(data);
      if (!m) return;
      if (isAuthChallengeFrame(m)) {
        challenge = m[1];
        if (authPending) tryAuthenticate();
        return;
      }
      if (authId && m[0] === 'OK' && m[1] === authId) {
        authId = null;
        authPending = false;
        if (m[2] !== true) {
          return finish(sdkError('Relay authentication refused', { code: 'auth-required', retryable: false, relay: url }));
        }
        id += '-auth';
        send(['REQ', id, filter]);
        return;
      }
      if (m[1] !== id) return;
      if (m[0] === 'EVENT') {
        try {
          const e = verify ? assertSignedEvent(m[2]) : m[2];
          if (cap > 0 && e?.id && matchesFilter(e, filter)) events.set(e.id, e);
        } catch {}
        if (cap > 0 && events.size >= cap) finish();
      } else if (m[0] === 'EOSE') {
        finish();
      } else if (m[0] === 'CLOSED') {
        if (isAuthRequired(m[2]) && authSigner && !authAttempted) {
          authPending = true;
          tryAuthenticate();
          return;
        }
        const code = isAuthRequired(m[2]) ? 'auth-required' : 'closed';
        finish(sdkError('Relay subscription rejected', { code, retryable: false, relay: url }));
      }
    };
  });
}

/** Exact event ACK + readback; optional explicitly authorized NIP-42 and ephemeral delivery. */
export function publishRelay(
  url,
  event,
  {
    Socket = globalThis.WebSocket,
    timeoutMs = 10000,
    signal,
    verify = true,
    authSigner,
    authPubkey,
    requireAuthentication = false,
    acceptEphemeral = false,
  } = {}
) {
  url = endpoint(url);
  event = verify ? verifiedCopy(event) : structuredClone(event);
  if (!Socket) throw new Error('WebSocket transport unavailable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new RangeError('Invalid publication timeout');
  validateRelayAuthOptions(authSigner, authPubkey, { requireVerify: verify });
  const protectedEvent = event.tags.some(t => t[0] === '-');
  if (protectedEvent && (!authSigner || authPubkey !== event.pubkey)) throw new Error('Protected event requires author authentication');
  if (requireAuthentication && !authSigner) throw new Error('Authentication capability required');
  if ([22242, 24242, 27235].includes(event.kind)) throw new Error('Transport auth event is not publishable');
  const ephemeral = acceptEphemeral === true && classifyEventStorage(event.kind) === 'ephemeral';
  if (signal?.aborted) return Promise.reject(sdkError('Publish cancelled', { code: 'cancelled', retryable: false, relay: url }));

  const budget = createFrameBudget({ maxFrames: 1024, maxBytes: 2097152, relay: url, code: 'size' });

  return new Promise((resolve, reject) => {
    const ws = new Socket(url);
    let id = 'read-' + event.id.slice(0, 16);
    let done = false;
    let accepted = false;
    let timer;
    let phase = 'opening';
    let challenge = null;
    let authId = null;
    let attempted = false;
    let authenticated = false;
    let afterAuth = 'event';

    const abort = () => finish(sdkError('Publish cancelled', { code: 'cancelled', retryable: false, relay: url }));
    const finish = err => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try { ws.close(); } catch {}
      if (err) {
        err.accepted = accepted;
        reject(err);
      } else {
        const receipt = { relay: url, eventId: event.id, accepted: true, readback: !ephemeral };
        if (authenticated) receipt.authenticated = true;
        resolve(receipt);
      }
    };
    const refused = reason => classifyRelayRefusal(reason, url);
    const send = message => {
      if (done) return;
      try { ws.send(JSON.stringify(message)); } catch (cause) {
        finish(sdkError('Relay send failed', { code: 'network', retryable: true, relay: url, cause }));
      }
    };
    const write = () => { phase = 'event'; send(['EVENT', event]); };
    const read = () => { phase = 'read'; send(['REQ', id, { ids: [event.id], limit: 1 }]); };
    const authenticate = () => {
      if (done || phase !== 'wait-auth' || !challenge) return;
      if (attempted || !authSigner) {
        return finish(sdkError('Relay authentication unavailable or refused', { code: 'auth-required', retryable: false, relay: url }));
      }
      attempted = true;
      phase = 'sign-auth';
      const usedChallenge = challenge;
      Promise.resolve()
        .then(() => {
          if (done) throw sdkError('Publish cancelled', { code: 'cancelled', retryable: false, relay: url });
          return signRelayAuthChallenge({ challenge: usedChallenge, relay: url, authSigner, authPubkey });
        })
        .then(auth => {
          if (done) return;
          if (challenge !== usedChallenge) {
            return finish(sdkError('Relay AUTH challenge changed', { code: 'auth-required', retryable: true, relay: url }));
          }
          authId = auth.id;
          phase = 'auth-ack';
          send(['AUTH', auth]);
        })
        .catch(cause => finish(sdkError('Relay authentication denied or invalid', { code: 'auth-required', retryable: false, relay: url, cause })));
    };
    const needAuth = next => {
      if (attempted || authenticated || !authSigner) {
        return finish(sdkError('Relay authentication unavailable or refused', { code: 'auth-required', retryable: false, relay: url }));
      }
      afterAuth = next;
      phase = 'wait-auth';
      authenticate();
    };

    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    timer = setTimeout(
      () => finish(sdkError('Relay publication or authentication timeout', { code: 'timeout', retryable: true, relay: url })),
      timeoutMs
    );

    ws.onopen = () => {
      if (done) return;
      if (requireAuthentication || protectedEvent) needAuth('event');
      else write();
    };
    ws.onerror = () => finish(sdkError('Relay WebSocket error', { code: 'network', retryable: true, relay: url }));
    ws.onclose = () => {
      if (!done) finish(sdkError('Relay closed before verified readback', { code: 'network', retryable: true, relay: url }));
    };
    ws.onmessage = ({ data }) => {
      if (done) return;
      const limitErr = budget.consume(data);
      if (limitErr) return finish(limitErr);
      const m = parseWireFrame(data);
      if (!m) return;
      if (isAuthChallengeFrame(m)) {
        if (phase === 'auth-ack' && challenge !== m[1]) {
          return finish(sdkError('Relay AUTH challenge changed', { code: 'auth-required', retryable: true, relay: url }));
        }
        challenge = m[1];
        authenticate();
        return;
      }
      if (phase === 'auth-ack' && m[0] === 'OK' && m[1] === authId) {
        if (m[2] !== true) {
          return finish(sdkError('Relay authentication refused', { code: 'auth-required', retryable: false, relay: url }));
        }
        authenticated = true;
        if (afterAuth === 'read') { id += '-auth'; read(); }
        else write();
        return;
      }
      if (phase === 'event' && m[0] === 'OK' && m[1] === event.id) {
        if (m[2] !== true) {
          if (isAuthRequired(m[3])) return needAuth('event');
          return finish(refused(m[3]));
        }
        accepted = true;
        if (ephemeral) return finish();
        read();
        return;
      }
      if (phase === 'read' && accepted && m[0] === 'EVENT' && m[1] === id && m[2]?.id === event.id) {
        try {
          if (verify) assertSignedEvent(m[2]);
          finish();
        } catch (cause) {
          finish(sdkError('Readback signature invalid', { code: 'rejected', retryable: false, relay: url, cause }));
        }
        return;
      }
      if (phase === 'read' && accepted && m[0] === 'EOSE' && m[1] === id) {
        finish(sdkError('Relay accepted event but readback returned EOSE', { code: 'readback-missing', retryable: true, relay: url }));
        return;
      }
      if (phase === 'read' && m[1] === id && m[0] === 'CLOSED') {
        if (isAuthRequired(m[2])) return needAuth('read');
        finish(sdkError('Relay readback denied', { code: 'policy', retryable: false, relay: url }));
      }
    };
  });
}

/** Include per-relay failures; acceptance on one relay does not imply delivery to all. */
export async function publishMany(event, relays, { writer = publishRelay, ...options } = {}) {
  const destinations = endpoints(relays);
  const snapshot = structuredClone(event);
  assertSignedEvent(snapshot);
  const allowEphemeral = options.acceptEphemeral === true && classifyEventStorage(snapshot.kind) === 'ephemeral';
  const results = await Promise.allSettled(destinations.map(async relay => writer(relay, structuredClone(snapshot), options)));
  const ok = [], fail = [];
  for (let i = 0; i < results.length; i++) {
    const relay = destinations[i], r = results[i];
    if (r.status === 'fulfilled') {
      const v = r.value;
      if (isVerifiedReceipt(v, snapshot.id, relay)) {
        const entry = { relay, eventId: snapshot.id, accepted: true, readback: true };
        if (v.authenticated === true) entry.authenticated = true;
        ok.push(entry);
        continue;
      }
      if (allowEphemeral && v?.accepted === true && v.eventId === snapshot.id && v.relay === relay) {
        const entry = { relay, eventId: snapshot.id, accepted: true, readback: false };
        if (v.authenticated === true) entry.authenticated = true;
        ok.push(entry);
        continue;
      }
    }
    fail.push({
      relay,
      error: r.status === 'rejected' ? (r.reason?.message || String(r.reason)) : 'Missing explicit acknowledgment or exact-event readback',
    });
  }
  return { status: ok.length ? 'partially-verified' : 'unverified', verified: ok, failed: fail };
}
