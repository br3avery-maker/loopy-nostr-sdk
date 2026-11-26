import test from 'node:test';
import assert from 'node:assert/strict';
import {Core,Nostr,Nsite,Blossom} from '../src/index.js';
const key=Nostr.generateSecretKey(), original=Nostr.finalizeEvent(Nostr.eventTemplate({content:'original',tags:[['t','music']]}),key);
const relay='wss://relay.example', server='https://blob.example';
const forbidden=['https://[::1]','https://[::ffff:127.0.0.1]','https://[fd00::1]','https://[fe80::1]','https://172.16.0.1','https://172.31.255.255','https://0.0.0.0','https://100.64.0.1','https://127.1','https://2130706433','https://0x7f000001','https://localhost.','https://sub.localhost','https://machine.local.','https://machine.internal.','https://intranet'];
test('publishRelay snapshots the signed event before opening and retains its ID through readback',async()=>{
 const input=structuredClone(original);let sent;
 class Socket{constructor(){queueMicrotask(()=>this.onopen());}send(raw){const m=JSON.parse(raw);if(m[0]==='EVENT'){sent=m[1];input.id='0'.repeat(64);queueMicrotask(()=>this.onmessage({data:JSON.stringify(['OK',original.id,true,''])}));}else{assert.deepEqual(m[2].ids,[original.id]);queueMicrotask(()=>this.onmessage({data:JSON.stringify(['EVENT',m[1],original])}));}}close(){}}
 const pending=Nostr.publishRelay(relay,input,{Socket,timeoutMs:100});input.content='changed';input.tags[0][1]='different';const result=await pending;assert.deepEqual(sent,JSON.parse(JSON.stringify(original)));assert.equal(Nostr.verifyEvent(sent),true);assert.equal(result.eventId,original.id);
});
test('Blossom endpoint guard rejects local names and literal addresses without affecting relays',()=>{
 for(const url of forbidden)assert.throws(()=>Core.endpoint(url,'blossom'),/Private\/loopback/);
 assert.equal(Core.endpoint(server,'blossom'),server);assert.equal(Core.endpoint('wss://127.0.0.1:9000'), 'wss://127.0.0.1:9000');
});
test('signed manifest private endpoints never reach fetch; public fallback remains usable',async()=>{
 const data=Core.encode('hello'),prepared=await Nsite.prepareManifestFiles({'index.html':data});const template=Nsite.manifestTemplate(prepared);template.tags.push(...forbidden.map(url=>['server',url]),['server',server]);const signed=Nostr.finalizeEvent(template,key);const calls=[];
 const fetcher=async url=>{calls.push(url);return new Response(data);};const r=await Nsite.loadNsiteFile(signed,'/',{fetcher});assert.equal(r.server,server);assert.deepEqual(calls,[server+'/'+prepared.entries[0].hash]);
 calls.length=0;await assert.rejects(Blossom.fetchVerified(prepared.entries[0].hash,{servers:forbidden,fetcher}),/No Blossom copy/);assert.equal(calls.length,0);
});
