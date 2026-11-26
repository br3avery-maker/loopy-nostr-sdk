import { assertSignedEvent, eventTemplate } from './events.js';
import { assertHex } from '../core/guards.js';

const REQUEST_ID_RE = /^[a-zA-Z0-9_-]{4,128}$/;
const DISALLOWED_CALLBACK_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'blob:', 'file:', 'about:']);

function validateCallbackUrl(callbackUrl) {
  if (typeof callbackUrl !== 'string' || !callbackUrl.trim() || callbackUrl.length > 2048 || /[\u0000-\u001f\u007f]/.test(callbackUrl)) {
    throw new TypeError('Invalid NIP-55 callbackUrl');
  }
  let parsed;
  try { parsed = new URL(callbackUrl); } catch { throw new TypeError('Invalid NIP-55 callbackUrl'); }
  const proto = parsed.protocol.toLowerCase();
  if (DISALLOWED_CALLBACK_SCHEMES.has(proto) || proto === 'http:' || parsed.username || parsed.password) {
    throw new TypeError('Disallowed NIP-55 callbackUrl scheme or credentials');
  }
  if (!/^[a-z][a-z0-9+.-]*:$/.test(proto)) throw new TypeError('Invalid NIP-55 callbackUrl scheme');
  return parsed.href;
}

/** Construct a NIP-55 Android deep-link request, not a sign-in success. */
export function androidIntent({ type = 'get_public_key', requestId, event, currentPubkey, callbackUrl } = {}) {
  if (!['get_public_key', 'sign_event'].includes(type) || typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) {
    throw new TypeError('type and correlation requestId required');
  }
  let approvedEvent = null;
  if (type === 'sign_event') {
    if (!event || typeof event !== 'object') throw new TypeError('Unsigned event required');
    approvedEvent = eventTemplate(event);
  }
  if (currentPubkey !== undefined) assertHex(currentPubkey, 64, 'currentPubkey');
  const safeCallback = callbackUrl !== undefined ? validateCallbackUrl(callbackUrl) : undefined;
  const payload = approvedEvent ? encodeURIComponent(JSON.stringify(approvedEvent)) : '';
  const qs = new URLSearchParams({ type, id: requestId });
  if (approvedEvent) {
    qs.set('compressionType', 'none');
    qs.set('returnType', 'event');
  }
  if (currentPubkey) qs.set('current_user', currentPubkey);
  if (safeCallback) qs.set('callbackUrl', safeCallback);
  return `nostrsigner:${payload}?${qs}`;
}

export function verifyAndroidResult({ requestId, returnedId, event, template, expectedPubkey, rejected = false } = {}) {
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId) || typeof returnedId !== 'string' || requestId !== returnedId) {
    throw new Error('NIP-55 correlation mismatch');
  }
  if (rejected) throw new Error('User declined signing');
  assertHex(expectedPubkey, 64, 'expectedPubkey');
  if (!event || !template) throw new Error('No signed event returned');
  const approvedTemplate = eventTemplate(template);
  assertSignedEvent(event);
  if (
    event.pubkey !== expectedPubkey ||
    event.kind !== approvedTemplate.kind ||
    event.content !== approvedTemplate.content ||
    event.created_at !== approvedTemplate.created_at ||
    JSON.stringify(event.tags) !== JSON.stringify(approvedTemplate.tags)
  ) {
    throw new Error('Android signer returned a different event');
  }
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    created_at: event.created_at,
    content: event.content,
    tags: structuredClone(event.tags),
    sig: event.sig,
  };
}
