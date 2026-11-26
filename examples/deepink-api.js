/** This example illustrates the production API; host must supply actual approved signer and relays. */
import {Nostr,Blossom,Nsite,Storage,Archive,Directory} from '../src/index.js';
export async function createDeepinkServices({signer,bootstrapRelays,blossomServer}){
  const pubkey=await signer.getPublicKey();
  const discovered=await Nostr.discoverRelays(pubkey,{bootstrap:bootstrapRelays});
  const relays=discovered.relays;
  const local=Archive.contentStore(Storage.indexedDbStore({name:'deepink-cache'}));
  return {
    pubkey,relays,local,
    post:content=>Nostr.publishTemplate(Nostr.textNote(content),{signer,pubkey,relays}),
    reply:(content,target)=>Nostr.publishTemplate(Nostr.textNote(content,{replyTo:target}),{signer,pubkey,relays}),
    react:(target,emoji)=>Nostr.publishTemplate(Nostr.reaction(target,emoji),{signer,pubkey,relays}),
    feed:authors=>Nostr.fetchFeed({authors,relays}),
    upload:(data,path)=>Blossom.uploadVerified(data,{server:blossomServer,signer,pubkey,path}),
    publishSite:(files,identifier)=>Nsite.publishNsite(files,{signer,pubkey,server:blossomServer,relays,identifier}),
    collection:Directory.emptyState()
  };
}
