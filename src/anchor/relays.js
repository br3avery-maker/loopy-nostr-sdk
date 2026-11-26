/** Evidence-oriented relay role inspection adapted from Anchor's relay intelligence. No network requests. */
export function assessRelayOutbox(relay={}){
 const reasons=[];const status=relay.status||'unknown';
 if(relay.wsReachable===false||['unreachable','degraded'].includes(status)||relay.httpStatus>=500){reasons.push('observed-connection-failure');return {status:'exclude-write',role:'unreachable',reasons,verified:relay.wsReachable===false||status==='unreachable'}}
 if(relay.paymentRequired||relay.authRequired||relay.restrictedWrites){reasons.push('reported-write-policy');return {status:'restricted',role:'restricted',reasons,verified:false}}
 const label=`${relay.nip11Name||''} ${relay.nip11Description||''}`.toLowerCase();
 if(/\b(?:dm.only|private.messages|chat.only)\b/.test(label)){reasons.push('description-suggests-chat-relay');return {status:'specialty-review',role:'dm-chat',reasons,verified:false}}
 if(/\b(?:directory|indexer|relay.list)\b/.test(label)){reasons.push('description-suggests-directory');return {status:'specialty-review',role:'directory',reasons,verified:false}}
 if(relay.wsReachable===true&&relay.writeProbeAccepted===true){reasons.push('observed-write-acceptance');return {status:'write-candidate',role:'general',reasons,verified:true}}
 return {status:'unverified',role:'unknown',reasons:['no-verified-write-probe'],verified:false};
}
export function planVerifiedOutbox(relays,{max=4}={}){if(!Array.isArray(relays))throw TypeError('Relays array expected');const reviewed=relays.map(relay=>({...relay,audit:assessRelayOutbox(relay)}));return {write:reviewed.filter(r=>r.audit.status==='write-candidate').sort((a,b)=>(a.latencyMs??Infinity)-(b.latencyMs??Infinity)).slice(0,max).map(r=>r.url),reviewed,insufficientEvidence:!reviewed.some(r=>r.audit.status==='write-candidate')}}
