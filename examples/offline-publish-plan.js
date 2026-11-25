/** Run: node examples/offline-publish-plan.js. NO NETWORK, NO PUBLIC SIGNING. */
import {Nostr,Nsite,Archive} from '../src/index.js';
const files={'index.html':'<!doctype html><title>Loopy Demo</title><h1>Example only</h1>','style.css':'body{color:#ff1493}'};
const prepared=await Nsite.prepareManifestFiles(files);
const manifest=Nsite.manifestTemplate(prepared,{identifier:'example-site',title:'Example only'});
const zip=Archive.writeZip(files);
const recovered=await Archive.readZip(zip);
const probeKey=Nostr.generateSecretKey(); // disposable local demonstration key; never used in any relay
const signed=Nostr.finalizeEvent(manifest,probeKey);
const parsed=await Nsite.parseManifest(signed);
console.log(JSON.stringify({state:'OFFLINE_EXAMPLE_NO_PUBLICATION',files:prepared.entries.map(({path,hash,size})=>({path,hash,size})),aggregate:prepared.aggregate,zipBytes:zip.length,recoveredFiles:Object.keys(recovered).length,verifiedLocalSignature:parsed.verified},null,2));
