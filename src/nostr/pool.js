import { endpoint, endpoints } from '../core/urls.js';
import { isHex, classifyEventStorage, assertSafeInt } from '../core/guards.js';
import { sdkError } from '../core/http.js';
import { assertSignedEvent, checkedSign } from './events.js';
import { verifiedCopy } from './history.js';
import { relayAuthTemplate } from './other-nips.js';
import { matchesFilter } from './filter.js';

function parseFrame(raw) {
  try {
    return JSON.parse(typeof raw === 'string' ? raw : String(raw));
  } catch {
    return null;
  }
}

const isAuthRequired = reason =>
  typeof reason === 'string' && (reason === 'auth-required' || reason.startsWith('auth-required:'));

function classifyRefusal(reason, relay) {
  const prefix = typeof reason === 'string' ? reason.split(':', 1)[0].trim().toLowerCase() : '';
  const map = {
    'auth-required': 'auth-required',
    'rate-limited': 'rate-limited',
    'unsupported-kind': 'unsupported-kind',
    'payment-required': 'payment-required',
    blocked: 'policy',
    restricted: 'policy',
    'event-too-large': 'size',
    pow: 'pow',
    duplicate: 'duplicate',
    invalid: 'invalid',
  };
  const code = map[prefix] ?? 'rejected';
  return sdkError('Relay refused signed event', { code, retryable: code === 'rate-limited', relay });
}

function validateFilter(filter) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    throw new TypeError('Expected one Nostr filter object');
  }
  if (Object.hasOwn(filter, 'limit') && (!Number.isSafeInteger(filter.limit) || filter.limit < 0)) {
    throw new RangeError('Filter limit must be a nonnegative integer');
  }
  return structuredClone(filter);
}

function validateAuth(authSigner, authPubkey, { requireVerify = true } = {}) {
  if (authSigner !== undefined) {
    if (!requireVerify || typeof authSigner?.signEvent !== 'function' || !isHex(authPubkey, 64)) {
      throw new TypeError('Explicit verified AUTH signer and identity required');
    }
  }
}

/**
 * Single-relay persistent NIP-01 subscription with explicit EOSE vs live-event distinction,
 * optional signature verification, NIP-42 AUTH, and frame/byte DoS bounds.
 */
export function subscribeRelay(
  url,
  filter,
  {
    onEvent,
    onEose,
    onClosed,
    onError,
    Socket = globalThis.WebSocket,
    signal,
    verify = true,
    maxEvents = 5000,
    maxFrames = 65536,
    maxBytes = 64 * 1024 * 1024,
    authSigner,
    authPubkey,
  } = {}
) {
  url = endpoint(url);
  if (!Socket) throw new Error('WebSocket transport unavailable');
  const cleanFilter = validateFilter(filter);
  assertSafeInt(maxEvents, { min: 1, max: 100000, label: 'maxEvents' });
  assertSafeInt(maxFrames, { min: 1, max: 1000000, label: 'maxFrames' });
  assertSafeInt(maxBytes, { min: 1024, max: 512 * 1024 * 1024, label: 'maxBytes' });
  validateAuth(authSigner, authPubkey);

  let closed = false;
  if (signal?.aborted) {
    onError?.(sdkError('Relay subscription cancelled', { code: 'cancelled', retryable: false, relay: url }));
    return { close() {} };
  }

  const ws = new Socket(url);
  const encoder = new TextEncoder();
  const seenIds = new Set();
  let subId = 'sub-' + Math.random().toString(36).slice(2);
  let open = false;
  let eosed = false;
  let frameCount = 0;
  let receivedBytes = 0;
  let challenge = null;
  let authId = null;
  let authAttempted = false;
  let authPending = false;

  const close = ({ sendClose = true, reasonError = null } = {}) => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', onAbort);
    if (sendClose && open) {
      try {
        ws.send(JSON.stringify(['CLOSE', subId]));
      } catch {}
    }
    try {
      ws.close();
    } catch {}
    if (reasonError) onError?.(reasonError);
  };

  const onAbort = () =>
    close({
      sendClose: true,
      reasonError: sdkError('Relay subscription cancelled', { code: 'cancelled', retryable: false, relay: url }),
    });

  const send = msg => {
    if (closed) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (cause) {
      close({
        sendClose: false,
        reasonError: sdkError('Relay send failed', { code: 'network', retryable: true, relay: url, cause }),
      });
    }
  };

  const tryAuthenticate = () => {
    if (closed || !authPending || !challenge) return;
    if (authAttempted || !authSigner) {
      close({
        sendClose: false,
        reasonError: sdkError('Relay authentication unavailable or refused', {
          code: 'auth-required',
          retryable: false,
          relay: url,
        }),
      });
      return;
    }
    authAttempted = true;
    const usedChallenge = challenge;
    Promise.resolve()
      .then(() => {
        if (closed) throw sdkError('Relay subscription cancelled', { code: 'cancelled', retryable: false, relay: url });
        return checkedSign(authSigner, relayAuthTemplate({ challenge: usedChallenge, relay: url }), authPubkey);
      })
      .then(auth => {
        if (closed) return;
        if (challenge !== usedChallenge) {
          close({
            sendClose: false,
            reasonError: sdkError('Relay AUTH challenge changed', { code: 'auth-required', retryable: true, relay: url }),
          });
          return;
        }
        authId = auth.id;
        send(['AUTH', verifiedCopy(auth)]);
      })
      .catch(cause =>
        close({
          sendClose: false,
          reasonError: sdkError('Relay authentication denied or invalid', {
            code: 'auth-required',
            retryable: false,
            relay: url,
            cause,
          }),
        })
      );
  };

  signal?.addEventListener('abort', onAbort, { once: true });

  ws.onopen = () => {
    if (closed) return;
    open = true;
    send(['REQ', subId, cleanFilter]);
  };
  ws.onerror = () => {
    if (!closed) {
      close({
        sendClose: false,
        reasonError: sdkError('Relay WebSocket error', { code: 'network', retryable: true, relay: url }),
      });
    }
  };
  ws.onclose = () => {
    if (!closed) {
      close({
        sendClose: false,
        reasonError: sdkError(open ? 'Relay closed subscription' : 'Relay failed to connect', {
          code: 'network',
          retryable: true,
          relay: url,
        }),
      });
    }
  };
  ws.onmessage = ({ data }) => {
    if (closed) return;
    if (
      typeof data !== 'string' ||
      ++frameCount > maxFrames ||
      (receivedBytes += encoder.encode(data).length) > maxBytes
    ) {
      close({
        sendClose: false,
        reasonError: sdkError('Relay response limit exceeded', { code: 'size-limit', retryable: false, relay: url }),
      });
      return;
    }
    const m = parseFrame(data);
    if (!Array.isArray(m)) return;
    if (m[0] === 'AUTH' && typeof m[1] === 'string' && m[1].length > 0 && m[1].length <= 512) {
      challenge = m[1];
      if (authPending) tryAuthenticate();
      return;
    }
    if (authId && m[0] === 'OK' && m[1] === authId) {
      authId = null;
      authPending = false;
      if (m[2] !== true) {
        close({
          sendClose: false,
          reasonError: sdkError('Relay authentication refused', { code: 'auth-required', retryable: false, relay: url }),
        });
        return;
      }
      subId += '-auth';
      send(['REQ', subId, cleanFilter]);
      return;
    }
    if (m[1] !== subId) return;
    if (m[0] === 'EVENT') {
      try {
        const event = verify ? assertSignedEvent(m[2]) : m[2];
        if (!event?.id || !matchesFilter(event, cleanFilter)) return;
        if (seenIds.has(event.id)) return;
        seenIds.add(event.id);
        onEvent?.(event, { relay: url, live: eosed });
        if (seenIds.size >= maxEvents) {
          close({ sendClose: true });
        }
      } catch {}
    } else if (m[0] === 'EOSE') {
      if (!eosed) {
        eosed = true;
        onEose?.({ relay: url });
      }
    } else if (m[0] === 'CLOSED') {
      if (isAuthRequired(m[2]) && authSigner && !authAttempted) {
        authPending = true;
        tryAuthenticate();
        return;
      }
      const reason = typeof m[2] === 'string' ? m[2] : '';
      onClosed?.({ relay: url, reason });
      close({ sendClose: false });
    }
  };

  return {
    close() {
      close({ sendClose: true });
    },
  };
}

/**
 * Caller-owned stateless-module relay pool: reuses one WebSocket per canonical relay URL,
 * multiplexes concurrent REQ/EVENT operations, and caches NIP-42 AUTH per (socket, pubkey).
 * No module-level global state; call pool.close() when done.
 */
export function createRelayPool({
  Socket = globalThis.WebSocket,
  timeoutMs = 8000,
  authSigner: defaultAuthSigner,
  authPubkey: defaultAuthPubkey,
  maxFrames = 65536,
  maxBytes = 64 * 1024 * 1024,
} = {}) {
  if (!Socket) throw new Error('WebSocket transport unavailable');
  assertSafeInt(timeoutMs, { min: 1, max: 120000, label: 'timeoutMs' });
  assertSafeInt(maxFrames, { min: 1, max: 1000000, label: 'maxFrames' });
  assertSafeInt(maxBytes, { min: 1024, max: 512 * 1024 * 1024, label: 'maxBytes' });
  validateAuth(defaultAuthSigner, defaultAuthPubkey);

  const encoder = new TextEncoder();
  const sockets = new Map();
  const activeHandles = new Set();
  let poolClosed = false;
  let seq = 0;

  const assertOpen = () => {
    if (poolClosed) throw sdkError('Relay pool is closed', { code: 'closed', retryable: false });
  };

  const nextId = prefix => `${prefix}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

  function getConnection(relay) {
    assertOpen();
    let conn = sockets.get(relay);
    if (conn && !conn.dead) return conn;

    const ws = new Socket(relay);
    conn = {
      relay,
      ws,
      open: false,
      dead: false,
      queue: [],
      subs: new Map(),
      okWaiters: new Map(),
      challenge: null,
      challengeWaiters: [],
      authenticatedPubkeys: new Set(),
      authInFlight: new Map(),
      frameCount: 0,
      receivedBytes: 0,
      send(msg) {
        if (this.dead) return false;
        const payload = JSON.stringify(msg);
        if (!this.open) {
          this.queue.push(payload);
          return true;
        }
        try {
          this.ws.send(payload);
          return true;
        } catch (cause) {
          this.failAll(sdkError('Relay send failed', { code: 'network', retryable: true, relay, cause }));
          return false;
        }
      },
      waitChallenge(waitMs, signal) {
        if (this.challenge) return Promise.resolve(this.challenge);
        if (this.dead) return Promise.reject(sdkError('Relay closed', { code: 'network', retryable: true, relay }));
        return new Promise((resolve, reject) => {
          const entry = { resolve, reject, timer: null, onAbort: null };
          const cleanup = () => {
            clearTimeout(entry.timer);
            signal?.removeEventListener('abort', entry.onAbort);
            const idx = this.challengeWaiters.indexOf(entry);
            if (idx >= 0) this.challengeWaiters.splice(idx, 1);
          };
          entry.onAbort = () => {
            cleanup();
            reject(sdkError('Relay operation cancelled', { code: 'cancelled', retryable: false, relay }));
          };
          entry.timer = setTimeout(() => {
            cleanup();
            reject(sdkError('Relay AUTH challenge timeout', { code: 'timeout', retryable: true, relay }));
          }, waitMs);
          if (signal?.aborted) return entry.onAbort();
          signal?.addEventListener('abort', entry.onAbort, { once: true });
          const origResolve = resolve;
          entry.resolve = val => {
            cleanup();
            origResolve(val);
          };
          const origReject = reject;
          entry.reject = err => {
            cleanup();
            origReject(err);
          };
          this.challengeWaiters.push(entry);
        });
      },
      async authenticate(signer, pubkey, { waitMs = timeoutMs, signal } = {}) {
        if (!signer || !isHex(pubkey, 64)) {
          throw sdkError('Relay authentication unavailable or refused', {
            code: 'auth-required',
            retryable: false,
            relay,
          });
        }
        if (this.authenticatedPubkeys.has(pubkey)) return true;
        if (this.authInFlight.has(pubkey)) return this.authInFlight.get(pubkey);

        const promise = (async () => {
          const usedChallenge = await this.waitChallenge(waitMs, signal);
          if (this.dead) throw sdkError('Relay closed', { code: 'network', retryable: true, relay });
          if (signal?.aborted) throw sdkError('Relay operation cancelled', { code: 'cancelled', retryable: false, relay });
          let signed;
          try {
            signed = await checkedSign(signer, relayAuthTemplate({ challenge: usedChallenge, relay }), pubkey);
          } catch (cause) {
            throw sdkError('Relay authentication denied or invalid', {
              code: 'auth-required',
              retryable: false,
              relay,
              cause,
            });
          }
          if (this.dead) throw sdkError('Relay closed', { code: 'network', retryable: true, relay });
          if (this.challenge !== usedChallenge) {
            throw sdkError('Relay AUTH challenge changed', { code: 'auth-required', retryable: true, relay });
          }
          const ack = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              this.okWaiters.delete(signed.id);
              reject(sdkError('Relay AUTH timeout', { code: 'timeout', retryable: true, relay }));
            }, waitMs);
            const onAbort = () => {
              clearTimeout(timer);
              this.okWaiters.delete(signed.id);
              reject(sdkError('Relay operation cancelled', { code: 'cancelled', retryable: false, relay }));
            };
            if (signal?.aborted) return onAbort();
            signal?.addEventListener('abort', onAbort, { once: true });
            this.okWaiters.set(signed.id, {
              resolve: res => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                resolve(res);
              },
              reject: err => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                reject(err);
              },
            });
            this.send(['AUTH', verifiedCopy(signed)]);
          });
          if (!ack.ok) {
            throw sdkError('Relay authentication refused', { code: 'auth-required', retryable: false, relay });
          }
          this.authenticatedPubkeys.add(pubkey);
          return true;
        })().finally(() => {
          this.authInFlight.delete(pubkey);
        });

        this.authInFlight.set(pubkey, promise);
        return promise;
      },
      failAll(err) {
        if (this.dead) return;
        this.dead = true;
        this.open = false;
        if (sockets.get(relay) === this) sockets.delete(relay);
        const subs = [...this.subs.values()];
        this.subs.clear();
        for (const sub of subs) sub.onError?.(err);
        const waiters = [...this.okWaiters.values()];
        this.okWaiters.clear();
        for (const w of waiters) w.reject(err);
        const chall = [...this.challengeWaiters];
        this.challengeWaiters.length = 0;
        for (const c of chall) c.reject(err);
        try {
          this.ws.close();
        } catch {}
      },
    };

    ws.onopen = () => {
      if (conn.dead) return;
      conn.open = true;
      const queued = conn.queue.splice(0);
      for (const payload of queued) {
        try {
          ws.send(payload);
        } catch (cause) {
          conn.failAll(sdkError('Relay send failed', { code: 'network', retryable: true, relay, cause }));
          return;
        }
      }
    };
    ws.onerror = () => {
      conn.failAll(sdkError('Relay WebSocket error', { code: 'network', retryable: true, relay }));
    };
    ws.onclose = () => {
      conn.failAll(
        sdkError(conn.open ? 'Relay closed connection' : 'Relay failed to connect', {
          code: 'network',
          retryable: true,
          relay,
        })
      );
    };
    ws.onmessage = ({ data }) => {
      if (conn.dead) return;
      if (
        typeof data !== 'string' ||
        ++conn.frameCount > maxFrames ||
        (conn.receivedBytes += encoder.encode(data).length) > maxBytes
      ) {
        conn.failAll(sdkError('Relay response limit exceeded', { code: 'size-limit', retryable: false, relay }));
        return;
      }
      const m = parseFrame(data);
      if (!Array.isArray(m)) return;
      if (m[0] === 'AUTH' && typeof m[1] === 'string' && m[1].length > 0 && m[1].length <= 512) {
        conn.challenge = m[1];
        const waiters = conn.challengeWaiters.splice(0);
        for (const w of waiters) w.resolve(conn.challenge);
        return;
      }
      if (m[0] === 'OK' && typeof m[1] === 'string') {
        const waiter = conn.okWaiters.get(m[1]);
        if (waiter) {
          conn.okWaiters.delete(m[1]);
          waiter.resolve({ ok: m[2] === true, message: typeof m[3] === 'string' ? m[3] : '' });
        }
        return;
      }
      if (typeof m[1] !== 'string') return;
      const sub = conn.subs.get(m[1]);
      if (!sub) return;
      if (m[0] === 'EVENT') sub.onEvent?.(m[2]);
      else if (m[0] === 'EOSE') sub.onEose?.();
      else if (m[0] === 'CLOSED') sub.onClosed?.(typeof m[2] === 'string' ? m[2] : '');
    };

    sockets.set(relay, conn);
    return conn;
  }

  function queryOne(relay, cleanFilter, opts) {
    const effectiveTimeout = opts.timeoutMs ?? timeoutMs;
    const signer = opts.authSigner ?? defaultAuthSigner;
    const pubkey = opts.authPubkey ?? defaultAuthPubkey;
    const cap = Math.min(opts.maxEvents, cleanFilter.limit ?? opts.maxEvents);

    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) {
        return reject(sdkError('Relay query cancelled', { code: 'cancelled', retryable: false, relay }));
      }
      const conn = getConnection(relay);
      const events = new Map();
      let subId = nextId('req');
      let done = false;
      let authTried = false;

      const finish = err => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        conn.subs.delete(subId);
        if (!conn.dead) conn.send(['CLOSE', subId]);
        err ? reject(err) : resolve([...events.values()]);
      };

      const onAbort = () => finish(sdkError('Relay query cancelled', { code: 'cancelled', retryable: false, relay }));
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(
        () => finish(sdkError('Relay EOSE timeout', { code: 'timeout', retryable: true, relay })),
        effectiveTimeout
      );

      const attach = id => {
        conn.subs.set(id, {
          onEvent: raw => {
            if (done) return;
            try {
              const ev = opts.verify ? assertSignedEvent(raw) : raw;
              if (cap > 0 && ev?.id && matchesFilter(ev, cleanFilter)) events.set(ev.id, ev);
            } catch {}
            if (cap > 0 && events.size >= cap) finish();
          },
          onEose: () => finish(),
          onClosed: reason => {
            if (done) return;
            if (isAuthRequired(reason) && signer && !authTried) {
              authTried = true;
              conn.subs.delete(subId);
              conn
                .authenticate(signer, pubkey, { waitMs: effectiveTimeout, signal: opts.signal })
                .then(() => {
                  if (done) return;
                  subId = nextId('req-auth');
                  attach(subId);
                  conn.send(['REQ', subId, cleanFilter]);
                })
                .catch(err => finish(err));
              return;
            }
            const code = isAuthRequired(reason) ? 'auth-required' : 'closed';
            finish(sdkError('Relay subscription rejected', { code, retryable: false, relay }));
          },
          onError: err => finish(err),
        });
      };

      attach(subId);
      conn.send(['REQ', subId, cleanFilter]);
    });
  }

  async function publishOne(relay, snapshot, opts) {
    const effectiveTimeout = opts.timeoutMs ?? timeoutMs;
    const signer = opts.authSigner ?? defaultAuthSigner;
    const pubkey = opts.authPubkey ?? defaultAuthPubkey;
    const protectedEvent = snapshot.tags.some(t => t[0] === '-');
    if (protectedEvent && (!signer || pubkey !== snapshot.pubkey)) {
      throw new Error('Protected event requires author authentication');
    }
    if (opts.requireAuthentication && !signer) throw new Error('Authentication capability required');
    if (opts.signal?.aborted) throw sdkError('Publish cancelled', { code: 'cancelled', retryable: false, relay });

    const conn = getConnection(relay);
    let authenticated = conn.authenticatedPubkeys.has(pubkey);
    if ((opts.requireAuthentication || protectedEvent) && !authenticated) {
      await conn.authenticate(signer, pubkey, { waitMs: effectiveTimeout, signal: opts.signal });
      authenticated = true;
    }

    const sendEventAndAwaitOk = () =>
      new Promise((resolve, reject) => {
        if (opts.signal?.aborted) return reject(sdkError('Publish cancelled', { code: 'cancelled', retryable: false, relay }));
        const timer = setTimeout(() => {
          conn.okWaiters.delete(snapshot.id);
          reject(sdkError('Relay publication timeout', { code: 'timeout', retryable: true, relay }));
        }, effectiveTimeout);
        const onAbort = () => {
          clearTimeout(timer);
          conn.okWaiters.delete(snapshot.id);
          reject(sdkError('Publish cancelled', { code: 'cancelled', retryable: false, relay }));
        };
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        conn.okWaiters.set(snapshot.id, {
          resolve: res => {
            clearTimeout(timer);
            opts.signal?.removeEventListener('abort', onAbort);
            resolve(res);
          },
          reject: err => {
            clearTimeout(timer);
            opts.signal?.removeEventListener('abort', onAbort);
            reject(err);
          },
        });
        conn.send(['EVENT', snapshot]);
      });

    let okRes = await sendEventAndAwaitOk();
    if (!okRes.ok && isAuthRequired(okRes.message) && signer && !authenticated) {
      await conn.authenticate(signer, pubkey, { waitMs: effectiveTimeout, signal: opts.signal });
      authenticated = true;
      okRes = await sendEventAndAwaitOk();
    }
    if (!okRes.ok) throw classifyRefusal(okRes.message, relay);

    const ephemeral = opts.acceptEphemeral === true && classifyEventStorage(snapshot.kind) === 'ephemeral';
    if (ephemeral) {
      const receipt = { relay, eventId: snapshot.id, accepted: true, readback: false };
      if (authenticated) receipt.authenticated = true;
      return receipt;
    }

    const found = await queryOne(relay, { ids: [snapshot.id], limit: 1 }, {
      timeoutMs: effectiveTimeout,
      signal: opts.signal,
      verify: opts.verify,
      maxEvents: 1,
      authSigner: signer,
      authPubkey: pubkey,
    });
    if (!found.some(e => e.id === snapshot.id)) {
      throw sdkError('Relay accepted event but readback returned EOSE', {
        code: 'readback-missing',
        retryable: true,
        relay,
      });
    }
    const receipt = { relay, eventId: snapshot.id, accepted: true, readback: true };
    if (authenticated || conn.authenticatedPubkeys.has(pubkey)) receipt.authenticated = true;
    return receipt;
  }

  return {
    async query(relays, filter, opts = {}) {
      assertOpen();
      const targets = endpoints(relays);
      if (!targets.length) throw new TypeError('At least one relay required');
      const cleanFilter = validateFilter(filter);
      const qTimeout = opts.timeoutMs ?? timeoutMs;
      assertSafeInt(qTimeout, { min: 1, max: 120000, label: 'timeoutMs' });
      const maxEvents = opts.maxEvents ?? 500;
      assertSafeInt(maxEvents, { min: 1, max: 100000, label: 'maxEvents' });
      const verify = opts.verify !== false;
      validateAuth(opts.authSigner, opts.authPubkey);

      const settled = await Promise.allSettled(
        targets.map(relay =>
          queryOne(relay, cleanFilter, {
            timeoutMs: qTimeout,
            signal: opts.signal,
            verify,
            maxEvents,
            authSigner: opts.authSigner,
            authPubkey: opts.authPubkey,
          })
        )
      );
      const dedup = new Map();
      const okRelays = [];
      const failed = [];
      for (let i = 0; i < targets.length; i++) {
        const relay = targets[i];
        const r = settled[i];
        if (r.status === 'fulfilled') {
          okRelays.push(relay);
          for (const ev of r.value) dedup.set(ev.id, ev);
        } else {
          failed.push({
            relay,
            code: r.reason?.code ?? 'network',
            error: r.reason?.message || String(r.reason),
          });
        }
      }
      const events = [...dedup.values()].sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
      return { events, relays: okRelays, failed };
    },

    subscribe(
      relays,
      filter,
      { onEvent, onEose, onClosed, onError, signal, verify = true, maxEvents = 5000, authSigner, authPubkey } = {}
    ) {
      assertOpen();
      const targets = endpoints(relays);
      if (!targets.length) throw new TypeError('At least one relay required');
      const cleanFilter = validateFilter(filter);
      assertSafeInt(maxEvents, { min: 1, max: 100000, label: 'maxEvents' });
      validateAuth(authSigner, authPubkey);

      const signer = authSigner ?? defaultAuthSigner;
      const pubkey = authPubkey ?? defaultAuthPubkey;
      const seenIds = new Set();
      const eosedRelays = new Set();
      const perRelay = new Map();
      let closed = false;

      const handle = {
        close() {
          if (closed) return;
          closed = true;
          activeHandles.delete(handle);
          signal?.removeEventListener('abort', onAbort);
          for (const [relay, state] of perRelay) {
            state.conn.subs.delete(state.subId);
            if (!state.conn.dead) state.conn.send(['CLOSE', state.subId]);
          }
          perRelay.clear();
        },
      };

      const onAbort = () => {
        handle.close();
        onError?.(sdkError('Relay subscription cancelled', { code: 'cancelled', retryable: false }));
      };

      if (signal?.aborted) {
        onError?.(sdkError('Relay subscription cancelled', { code: 'cancelled', retryable: false }));
        return { close() {} };
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      activeHandles.add(handle);

      for (const relay of targets) {
        const conn = getConnection(relay);
        const state = { conn, subId: nextId('sub'), authTried: false };
        perRelay.set(relay, state);

        const attach = id => {
          conn.subs.set(id, {
            onEvent: raw => {
              if (closed) return;
              try {
                const ev = verify ? assertSignedEvent(raw) : raw;
                if (!ev?.id || !matchesFilter(ev, cleanFilter)) return;
                if (seenIds.has(ev.id)) return;
                seenIds.add(ev.id);
                onEvent?.(ev, { relay, live: eosedRelays.has(relay) });
                if (seenIds.size >= maxEvents) handle.close();
              } catch {}
            },
            onEose: () => {
              if (closed || eosedRelays.has(relay)) return;
              eosedRelays.add(relay);
              onEose?.({ relay, allEosed: eosedRelays.size === targets.length });
            },
            onClosed: reason => {
              if (closed) return;
              if (isAuthRequired(reason) && signer && !state.authTried) {
                state.authTried = true;
                conn.subs.delete(state.subId);
                conn
                  .authenticate(signer, pubkey, { waitMs: timeoutMs, signal })
                  .then(() => {
                    if (closed) return;
                    state.subId = nextId('sub-auth');
                    attach(state.subId);
                    conn.send(['REQ', state.subId, cleanFilter]);
                  })
                  .catch(err => onError?.(err));
                return;
              }
              conn.subs.delete(state.subId);
              perRelay.delete(relay);
              onClosed?.({ relay, reason });
            },
            onError: err => {
              if (closed) return;
              perRelay.delete(relay);
              onError?.(err);
            },
          });
        };

        attach(state.subId);
        conn.send(['REQ', state.subId, cleanFilter]);
      }

      return handle;
    },

    async publish(relays, event, opts = {}) {
      assertOpen();
      const targets = endpoints(relays);
      if (!targets.length) throw new TypeError('At least one relay required');
      const verify = opts.verify !== false;
      const snapshot = verify ? verifiedCopy(event) : structuredClone(event);
      if ([22242, 24242, 27235].includes(snapshot.kind)) {
        throw new Error('Transport auth event is not publishable');
      }
      const pTimeout = opts.timeoutMs ?? timeoutMs;
      assertSafeInt(pTimeout, { min: 1, max: 120000, label: 'timeoutMs' });
      validateAuth(opts.authSigner, opts.authPubkey, { requireVerify: verify });

      const settled = await Promise.allSettled(
        targets.map(relay =>
          publishOne(relay, snapshot, {
            timeoutMs: pTimeout,
            signal: opts.signal,
            verify,
            authSigner: opts.authSigner,
            authPubkey: opts.authPubkey,
            requireAuthentication: opts.requireAuthentication === true,
            acceptEphemeral: opts.acceptEphemeral === true,
          })
        )
      );
      const ok = [];
      const fail = [];
      for (let i = 0; i < targets.length; i++) {
        const relay = targets[i];
        const r = settled[i];
        if (r.status === 'fulfilled') ok.push(r.value);
        else fail.push({ relay, error: r.reason?.message || String(r.reason) });
      }
      return { status: ok.length ? 'partially-verified' : 'unverified', verified: ok, failed: fail };
    },

    relays() {
      return [...sockets.keys()];
    },

    close() {
      if (poolClosed) return;
      poolClosed = true;
      for (const h of [...activeHandles]) h.close();
      activeHandles.clear();
      const err = sdkError('Relay pool closed', { code: 'cancelled', retryable: false });
      for (const conn of [...sockets.values()]) conn.failAll(err);
      sockets.clear();
    },
  };
}
