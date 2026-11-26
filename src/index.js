import * as Core from './core/index.js';
import * as Nostr from './nostr/index.js';
import * as Nsite from './nsite/index.js';
import * as Blossom from './blossom/index.js';
import * as Archive from './archive/index.js';
import * as Directory from './directory/index.js';
import * as Storage from './storage/index.js';
import * as Adapters from './adapters/index.js';
import * as Moderation from './moderation/index.js';
import * as Moji from './moji/index.js';
import * as Anchor from './anchor/index.js';
import * as Intelligence from './intelligence/index.js';
import * as Testing from './testing/index.js';
export { Core,Nostr,Nsite,Blossom,Archive,Directory,Storage,Adapters,Moderation,Moji,Anchor,Intelligence,Testing };
/** Unified facade: modules are independently usable, while this binds shared signer and destination options. */
export function createNsiteSDK(options={}){
  const normalized=Core.normalizeOptions(options);
  const config=Object.freeze({...normalized,relays:Object.freeze([...normalized.relays])});
  return Object.freeze({
    options:config,
    core:Core,nostr:Nostr,nsite:Nsite,blossom:Blossom,archive:Archive,directory:Directory,storage:Storage,adapters:Adapters,moderation:Moderation,moji:Moji,anchor:Anchor,intelligence:Intelligence,
    async publish(files,overrides={}){const signer=overrides.signer||config.signer;const pubkey=overrides.pubkey||(signer?.getPublicKey?await signer.getPublicKey():undefined);return Nsite.publishNsite(files,{...config,...overrides,signer,pubkey})},
    async query(filter,overrides={}){
      const opts={Socket:config.Socket,...overrides};
      if(overrides.relay)return Nostr.queryRelay(overrides.relay,filter,opts);
      const relays=Array.isArray(overrides.relays)?Core.endpoints(overrides.relays,'relay'):config.relays;
      if(!relays.length)throw Core.sdkError('No relay selected',{code:'no-relay',stage:'query'});
      if(relays.length===1)return Nostr.queryRelay(relays[0],filter,opts);
      const settled=await Promise.allSettled(relays.map(relay=>Nostr.queryRelay(relay,filter,opts)));
      const byId=new Map();let fulfilled=0;let firstError=null;
      for(const result of settled){
        if(result.status==='fulfilled'){fulfilled++;for(const event of result.value)if(event?.id&&!byId.has(event.id))byId.set(event.id,event)}
        else if(!firstError)firstError=result.reason;
      }
      if(!fulfilled&&firstError)throw firstError;
      return [...byId.values()].sort((a,b)=>(b.created_at-a.created_at)||(a.id<b.id?-1:a.id>b.id?1:0));
    },
    async close(){
      const results=await Promise.allSettled([
        Promise.resolve().then(()=>config.signer?.close?.()),
        Promise.resolve().then(()=>config.storage?.close?.())
      ]);
      const rejected=results.find(r=>r.status==='rejected');
      if(rejected)throw rejected.reason;
    }
  });
}
