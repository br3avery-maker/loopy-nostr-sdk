import {BunkerSigner, createNostrConnectURI, generateSecretKey, getPublicKey, parseBunkerInput} from '../../vendor/nostr.js';
import {checkedSign} from './events.js';
/** Browser NIP-07 adapter. No private keys stored. */
export function browserSigner(provider=globalThis.window?.nostr) {
  if (!provider || typeof provider.getPublicKey!=='function' || typeof provider.signEvent!=='function') throw new Error('No NIP-07 browser signer available');
  return {mode:'nip07',getPublicKey:()=>provider.getPublicKey(),signEvent:e=>provider.signEvent(e)};
}
/** Use a signer-provided bunker:// URI. Does not connect until connect() is called. */
export async function bunkerSigner(uri,{clientSecret=generateSecretKey(),connectOptions={}}={}) {
  const pointer=await parseBunkerInput(uri);
  if (!pointer) throw new TypeError('Invalid NIP-46 bunker URI');
  let signer=null, pending=null, connected=false, closed=false;
  const requireConnected=()=>{if(!connected||!signer||closed)throw new Error('NIP-46 signer not connected');return signer;};
  return {
    mode:'nip46',
    async connect(){
      if(closed)throw new Error('NIP-46 signer closed');
      if(connected)return signer.getPublicKey();
      if(pending)return pending;
      const attempt=BunkerSigner.fromBunker(clientSecret,pointer);signer=attempt;
      pending=(async()=>{try{await attempt.connect(connectOptions);if(closed||signer!==attempt)throw new Error('NIP-46 signer closed');const key=await attempt.getPublicKey();if(closed||signer!==attempt)throw new Error('NIP-46 signer closed');connected=true;return key;}catch(e){if(signer===attempt){signer=null;connected=false;try{await attempt.close()}catch{}}throw e;}finally{pending=null;}})();
      return pending;
    },
    getPublicKey:async()=>requireConnected().getPublicKey(),
    signEvent:async template=>requireConnected().signEvent(template),
    async close(){closed=true;connected=false;const active=signer;signer=null;if(active)await active.close();}
  };
}
/** Copy-to-signer NIP-46 request. start() begins listening before the user switches apps. */
export function nostrConnectRequest({relays,name='Nsite Loopy SDK',perms=['get_public_key','sign_event'],secret,clientSecret=generateSecretKey()}={}) {
  if (!Array.isArray(relays)||!relays.length) throw new TypeError('NIP-46 transport relays required');
  const nonce=secret || Array.from(crypto.getRandomValues(new Uint8Array(20)),b=>b.toString(16).padStart(2,'0')).join('');
  const uri=createNostrConnectURI({clientPubkey:getPublicKey(clientSecret),relays,secret:nonce,name,perms});
  return {uri,mode:'nip46',start:async(signal)=>BunkerSigner.fromURI(clientSecret,uri,{},signal)};
}
export async function connectIdentity(signer){const pubkey=await signer.getPublicKey();if(!/^[a-f0-9]{64}$/.test(pubkey))throw new Error('Invalid public key from signer');return {pubkey,signer};}
export {checkedSign};
