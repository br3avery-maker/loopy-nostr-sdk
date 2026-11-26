import {androidIntent,verifyAndroidResult} from '../nostr/nip55.js';
/** Browser-only NIP-55 launch MAY work in Android. Host must supply onReturn callback for reliable response. */
export function androidHandoff({launch,onReturn}={}){
  if(typeof launch!=='function'||typeof onReturn!=='function')throw new TypeError('Android host launch and onReturn callbacks are required');
  return {async sign({requestId,event,expectedPubkey}){const template=structuredClone(event);const uri=androidIntent({type:'sign_event',requestId,event:template,currentPubkey:expectedPubkey});const pending=onReturn(requestId);await launch(uri);const reply=await pending;return verifyAndroidResult({requestId,returnedId:reply.id,event:reply.event,template,expectedPubkey,rejected:reply.rejected})}};
}
