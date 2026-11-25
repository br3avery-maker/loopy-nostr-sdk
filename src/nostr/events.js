import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent as rawVerifyEvent, npubEncode } from '../../vendor/nostr.js';
export { finalizeEvent, generateSecretKey, getPublicKey, npubEncode };
/** Reconstruct a clean event so nostr-tools verification cache symbols cannot mask tampering. */
export function verifyEvent(event) { try { return rawVerifyEvent({id:event.id,pubkey:event.pubkey,kind:event.kind,created_at:event.created_at,content:event.content,tags:structuredClone(event.tags),sig:event.sig}); } catch { return false; } }
export function eventTemplate({kind=1, content='', tags=[], created_at=Math.floor(Date.now()/1000)}={}) {
  if (!Number.isSafeInteger(kind) || kind<0 || kind>65535 || !Number.isSafeInteger(created_at) || created_at<0 || typeof content!=='string' || !Array.isArray(tags) || tags.some(t=>!Array.isArray(t)||t.some(x=>typeof x!=='string'))) throw new TypeError('Invalid unsigned Nostr event');
  return {kind,content,tags,created_at};
}
export function assertSignedEvent(event, {verify=verifyEvent}={}) {
  if (!event || !/^[0-9a-f]{64}$/i.test(event.id||'') || !/^[0-9a-f]{64}$/i.test(event.pubkey||'') || !/^[0-9a-f]{128}$/i.test(event.sig||'') || !verify({id:event.id,pubkey:event.pubkey,kind:event.kind,created_at:event.created_at,content:event.content,tags:structuredClone(event.tags),sig:event.sig})) throw new Error('Invalid Nostr event signature or contents');
  return event;
}
export async function checkedSign(signer, template, expectedPubkey, {verify=verifyEvent}={}) {
  if (!signer || typeof signer.signEvent!=='function') throw new TypeError('Signer must implement signEvent');
  // Snapshot the approved wire fields before calling an injected signer.
  const approved=eventTemplate(template);
  const snapshot=structuredClone(approved);
  const event=await signer.signEvent(structuredClone(snapshot));
  assertSignedEvent(event,{verify});
  if (event.pubkey!==expectedPubkey || event.kind!==snapshot.kind || event.content!==snapshot.content || event.created_at!==snapshot.created_at || JSON.stringify(event.tags)!==JSON.stringify(snapshot.tags)) throw new Error('Signer changed approved event or account');
  return event;
}
