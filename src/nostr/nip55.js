import { assertSignedEvent } from './events.js';
/** Construct a NIP-55 Android deep-link request, not a sign-in success. */
export function androidIntent({type='get_public_key', requestId, event, currentPubkey, callbackUrl}={}) {
  if (!['get_public_key','sign_event'].includes(type) || typeof requestId!=='string' || !/^[a-zA-Z0-9_-]{4,128}$/.test(requestId)) throw new TypeError('type and correlation requestId required');
  if (type==='sign_event' && (!event || typeof event!=='object')) throw new TypeError('Unsigned event required');
  const payload=type==='sign_event'?encodeURIComponent(JSON.stringify(event)):'';
  const qs=new URLSearchParams({type,id:requestId});
  if (type==='sign_event'){qs.set('compressionType','none');qs.set('returnType','event');}
  if (currentPubkey) qs.set('current_user',currentPubkey);
  if (callbackUrl) qs.set('callbackUrl',callbackUrl);
  return `nostrsigner:${payload}?${qs}`;
}
export function verifyAndroidResult({requestId,returnedId,event,template,expectedPubkey,rejected=false}={}) {
  if (requestId!==returnedId) throw new Error('NIP-55 correlation mismatch');
  if (rejected) throw new Error('User declined signing');
  if (!event || !template) throw new Error('No signed event returned');
  assertSignedEvent(event);
  if (event.pubkey!==expectedPubkey || event.kind!==template.kind || event.content!==template.content || event.created_at!==template.created_at || JSON.stringify(event.tags)!==JSON.stringify(template.tags)) throw new Error('Android signer returned a different event');
  return event;
}
