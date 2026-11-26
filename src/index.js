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
export { Core,Nostr,Nsite,Blossom,Archive,Directory,Storage,Adapters,Moderation,Moji,Anchor,Intelligence };
/** Unified facade: modules are independently usable, while this binds shared signer and destination options. */
export function createNsiteSDK(options={}){
  const config=Core.normalizeOptions(options);
  return Object.freeze({
    options:config,
    core:Core,nostr:Nostr,nsite:Nsite,blossom:Blossom,archive:Archive,directory:Directory,storage:Storage,adapters:Adapters,moderation:Moderation,moji:Moji,anchor:Anchor,intelligence:Intelligence,
    async publish(files,overrides={}){const signer=overrides.signer||config.signer;const pubkey=overrides.pubkey||(signer?.getPublicKey?await signer.getPublicKey():undefined);return Nsite.publishNsite(files,{...config,...overrides,signer,pubkey})},
    query(filter,overrides={}){const relay=overrides.relay||config.relays[0];if(!relay)throw new Error('No relay selected');return Nostr.queryRelay(relay,filter,{Socket:config.Socket,...overrides})}
  });
}
