/**
 * Shared stateless NIP-01 wire framing, refusal classification, frame/byte DoS budgeting,
 * and NIP-42 AUTH challenge helpers used by both `relay-transport.js` and `pool.js`.
 */
import { isHex } from '../core/guards.js';
import { sdkError } from '../core/http.js';
import { checkedSign } from './events.js';
import { verifiedCopy } from './history.js';
import { relayAuthTemplate } from './other-nips.js';

const utf8Encoder = new TextEncoder();

export function parseWireFrame(raw) {
  try {
    const parsed = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isAuthRequired(reason) {
  return typeof reason === 'string' && (reason === 'auth-required' || reason.startsWith('auth-required:'));
}

export function isAuthChallengeFrame(frame) {
  return (
    Array.isArray(frame) &&
    frame[0] === 'AUTH' &&
    typeof frame[1] === 'string' &&
    frame[1].length > 0 &&
    frame[1].length <= 512
  );
}

const REFUSAL_CODES = Object.freeze({
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
});

export function classifyRelayRefusal(reason, relay) {
  const prefix = typeof reason === 'string' ? reason.split(':', 1)[0].trim().toLowerCase() : '';
  const code = Object.hasOwn(REFUSAL_CODES, prefix) ? REFUSAL_CODES[prefix] : 'rejected';
  return sdkError('Relay refused signed event', { code, retryable: code === 'rate-limited', relay });
}

export function validateRelayFilter(filter) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    throw new TypeError('Expected one Nostr filter object');
  }
  if (Object.hasOwn(filter, 'limit') && (!Number.isSafeInteger(filter.limit) || filter.limit < 0)) {
    throw new RangeError('Filter limit must be a nonnegative integer');
  }
  return structuredClone(filter);
}

export function validateRelayAuthOptions(authSigner, authPubkey, { requireVerify = true } = {}) {
  if (authSigner !== undefined) {
    if (!requireVerify || typeof authSigner?.signEvent !== 'function' || !isHex(authPubkey, 64)) {
      throw new TypeError('Explicit verified AUTH signer and identity required');
    }
  }
}

export function createFrameBudget({ maxFrames, maxBytes, relay, code = 'size-limit' }) {
  let frames = 0;
  let bytes = 0;
  return {
    consume(data) {
      if (typeof data !== 'string' || ++frames > maxFrames || (bytes += utf8Encoder.encode(data).length) > maxBytes) {
        return sdkError('Relay response limit exceeded', { code, retryable: false, relay });
      }
      return null;
    },
  };
}

export async function signRelayAuthChallenge({ challenge, relay, authSigner, authPubkey }) {
  const signed = await checkedSign(authSigner, relayAuthTemplate({ challenge, relay }), authPubkey);
  return verifiedCopy(signed);
}
