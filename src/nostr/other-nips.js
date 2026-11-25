import {eventTemplate,checkedSign} from './events.js';
import {endpoint} from '../core/urls.js';
import {toBase64Url,encode} from '../core/bytes.js';
/** NIP-42 authentication: challenge and relay binding are mandatory; no automatic signing. */
export function relayAuthTemplate({challenge,relay,created_at=Math.floor(Date.now()/1000)}={}){
  if(typeof challenge!=='string'||!challenge||challenge.length>512)throw new TypeError('Relay AUTH challenge required');
  return eventTemplate({kind:22242,created_at,tags:[['relay',endpoint(relay)],['challenge',challenge]],content:''});
}
/** NIP-98 HTTP auth signer; caller must supply the exact request URL and method. */
export async function httpAuthHeader({url,method,signer,pubkey,created_at=Math.floor(Date.now()/1000)}={}){
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw new TypeError('HTTPS URL without credentials required');
  if(!['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(method))throw new TypeError('HTTP method required');
  const event=await checkedSign(signer,eventTemplate({kind:27235,created_at,tags:[['u',u.href],['method',method]],content:''}),pubkey);
  return 'Nostr '+toBase64Url(encode(JSON.stringify(event)));
}
/** NIP-44 encryption adapter. A trusted signer must provide approved nip44 operations. */
export function encryptionAdapter(signer){
  const api=signer?.nip44;
  if(typeof api?.encrypt!=='function'||typeof api?.decrypt!=='function')throw new Error('Signer does not provide approved NIP-44 methods');
  return {encrypt:(peer,plaintext)=>api.encrypt(peer,plaintext),decrypt:(peer,ciphertext)=>api.decrypt(peer,ciphertext)};
}
