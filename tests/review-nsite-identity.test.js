import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeNsiteIdentity,detectAndPrepareContent,reconstructPreferences} from '../src/intelligence/index.js';
const site=(dTag,title)=>({id:dTag,title,dTag,mode:'named',format:'named-35128',fileCount:1,updatedAt:1700000000});
const alpha=site('alpha','Beta'),beta=site('beta','Actual target');
const assets=[{name:'index.html',path:'/index.html',mimeType:'text/html',sizeBytes:12,sha256:'a'.repeat(64)}];
const preferences=reconstructPreferences({events:[],relays:[{url:'wss://relay.example',read:true,write:true}],blossomServers:[{url:'https://blossom.example'}]});
test('exact named identifier wins regardless of an earlier matching title or array order',()=>{
  for(const existingSites of [[alpha,beta],[beta,alpha]]){
    const result=analyzeNsiteIdentity({existingSites,assets,requestedMode:'named',requestedSlug:'beta'});
    assert.equal(result.recommendedDTag,'beta');assert.equal(result.existingTarget.id,'beta');assert.equal(result.preservesIdentity,true);
  }
});
test('prepared nsite publication keeps the exact requested coordinate despite another matching title',()=>{
  const result=detectAndPrepareContent({submission:{assets,targetSiteSlug:'beta',targetSiteMode:'named'},preferences,corrections:[],existingSites:[alpha,beta]});
  assert.equal(result.kind,35128);assert.equal(result.dTag,'beta');assert.deepEqual(result.tags.filter(t=>t[0]==='d'),[['d','beta']]);assert.equal(result.nsiteAnalysis.existingTarget.id,'beta');
});
test('title fallback and new-site behavior are preserved when no identifier matches',()=>{
  const result=analyzeNsiteIdentity({existingSites:[alpha],assets,requestedSlug:'beta'});
  assert.equal(result.recommendedDTag,'alpha');assert.equal(result.preservesIdentity,true);
  const fresh=analyzeNsiteIdentity({existingSites:[alpha],assets,requestedSlug:'gamma'});
  assert.equal(fresh.recommendedDTag,'gamma');assert.equal(fresh.preservesIdentity,false);
});
