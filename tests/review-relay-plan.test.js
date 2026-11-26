import test from 'node:test';
import assert from 'node:assert/strict';
import {Intelligence} from '../src/index.js';
const rejected=Intelligence.CANDIDATE_DISCOVERY_RELAYS.map(({url})=>({url,read:true,write:true,status:'unreachable',wsReachable:false}));
test('known unhealthy baseline relays cannot return as fallback or specialty destinations',()=>{
  const result=Intelligence.buildRelayOptimizationPlan({currentRelays:rejected.slice(0,3),candidateRelays:rejected.slice(3)});
  for(const key of ['recommendedWriteRelays','recommendedReadRelays','recommendedMusicRelays','recommendedArticleRelays','proposedKind10002Tags'])assert.deepEqual(result[key],[],key);
});
test('conflicting negative probe evidence blocks a current or candidate relay in public write plans',()=>{
  const result=Intelligence.buildRelayOptimizationPlan({currentRelays:[{url:'wss://relay.damus.io/',read:true,write:true,status:'connected',wsReachable:true}],candidateRelays:[rejected[0],{url:'wss://relay.wavlake.com',read:true,write:true,status:'connected',authRequired:true}]});
  assert.ok(!result.recommendedWriteRelays.includes('wss://relay.damus.io'));
  assert.ok(!result.recommendedMusicRelays.includes('wss://relay.wavlake.com'));
  assert.ok(!result.proposedKind10002Tags.some(t=>t[1]==='wss://relay.damus.io'&&t[2]!=='read'));
});
