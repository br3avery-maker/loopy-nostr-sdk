import { endpoint } from '../core/urls.js';
import { isHex, assertSafeInt } from '../core/guards.js';
import { boundedFetch, defaultFetch } from '../core/http.js';

const LOCAL_PART_RE = /^[a-z0-9._-]+$/;

/**
 * Explicit opt-in bounded HTTPS NIP-05 identifier verifier.
 * Enforces public HTTPS hostname, redirect: 'error', credentials: 'omit', byte cap,
 * prototype-safe own-property lookup, strict 64-hex pubkey validation, and canonical relay hints.
 */
export async function verifyNip05(
  identifier,
  { expectedPubkey, fetcher = defaultFetch, timeoutMs = 8000, maxBytes = 256 * 1024, signal } = {}
) {
  if (typeof identifier !== 'string' || !identifier.includes('@')) {
    throw new TypeError('NIP-05 identifier must be in name@domain format');
  }
  if (expectedPubkey !== undefined && !isHex(expectedPubkey, 64)) {
    throw new TypeError('expectedPubkey must be 64-char lowercase hex');
  }
  if (typeof fetcher !== 'function') throw new TypeError('fetch transport required');
  assertSafeInt(timeoutMs, { min: 1, max: 60000, label: 'timeoutMs' });
  assertSafeInt(maxBytes, { min: 1024, max: 4 * 1024 * 1024, label: 'maxBytes' });

  const trimmed = identifier.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  const name = trimmed.slice(0, at);
  const rawDomain = trimmed.slice(at + 1);
  if (!name || name.length > 64 || !LOCAL_PART_RE.test(name)) {
    throw new TypeError('Invalid NIP-05 local name');
  }
  if (!rawDomain || rawDomain.includes('/') || rawDomain.includes(':') || rawDomain.includes('?') || rawDomain.includes('#')) {
    throw new TypeError('Invalid NIP-05 domain');
  }

  // Enforce public named HTTPS host (rejects localhost, IPs, private hosts, credentials).
  let base;
  try {
    base = endpoint('https://' + rawDomain, 'blossom', { publicHost: true });
  } catch (cause) {
    throw new TypeError('Invalid or private NIP-05 domain; public named HTTPS domain required', { cause });
  }
  const domain = new URL(base).hostname;
  const url = `${base}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;
  const normalizedId = `${name}@${domain}`;

  let res;
  try {
    res = await boundedFetch(
      url,
      { headers: { Accept: 'application/json' } },
      { fetcher, signal, timeoutMs, maxBytes, read: 'json' }
    );
  } catch (err) {
    if (err?.code === 'cancelled') throw err;
    return {
      identifier: normalizedId,
      name,
      domain,
      url,
      pubkey: null,
      relays: [],
      matched: false,
      verified: false,
      reason: err?.code || 'network',
    };
  }

  if (!res.ok) {
    return {
      identifier: normalizedId,
      name,
      domain,
      url,
      pubkey: null,
      relays: [],
      matched: false,
      verified: false,
      reason: `http-${res.status}`,
    };
  }

  const body = res.json;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.names || typeof body.names !== 'object') {
    return {
      identifier: normalizedId,
      name,
      domain,
      url,
      pubkey: null,
      relays: [],
      matched: false,
      verified: false,
      reason: 'invalid-payload',
    };
  }

  const rawPubkey = Object.hasOwn(body.names, name) ? body.names[name] : null;
  if (!isHex(rawPubkey, 64)) {
    return {
      identifier: normalizedId,
      name,
      domain,
      url,
      pubkey: null,
      relays: [],
      matched: false,
      verified: false,
      reason: rawPubkey == null ? 'not-found' : 'invalid-pubkey',
    };
  }

  const relays = [];
  if (body.relays && typeof body.relays === 'object' && Object.hasOwn(body.relays, rawPubkey)) {
    const hints = body.relays[rawPubkey];
    if (Array.isArray(hints)) {
      for (const hint of hints) {
        try {
          const canonical = endpoint(hint, 'relay');
          if (!relays.includes(canonical)) relays.push(canonical);
        } catch {}
      }
    }
  }

  const matched = expectedPubkey === undefined ? true : rawPubkey === expectedPubkey;
  return {
    identifier: normalizedId,
    name,
    domain,
    url,
    pubkey: rawPubkey,
    relays,
    matched,
    verified: matched,
    reason: matched ? null : 'pubkey-mismatch',
  };
}
