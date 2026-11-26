import {Archive,Storage} from '../src/index.js';
const store=Archive.contentStore(Storage.memoryStore());
const a=await store.put('same bytes'),b=await store.put('same bytes');
const manifest={files:[{path:'/index.html',hash:a.hash}]};
const restored=await Archive.materializeVersion(manifest,store);
console.log(JSON.stringify({deduplicated:a.hash===b.hash,restored:new TextDecoder().decode(restored['index.html'])}));
