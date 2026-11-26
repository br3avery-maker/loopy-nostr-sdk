import {assertSignedEvent} from './events.js';
import {endpoints,endpoint} from '../core/urls.js';
/** NIP-65 author kind 10002 relay list. Invalid/untrusted lists never silently replace saved endpoints. */
export function relayList(event,{verify=true}={}) {
  if (event?.kind!==10002) throw new TypeError('Not a kind 10002 relay list');
  if (verify) assertSignedEvent(event);
  const entries=[];
  for(const tag of event.tags||[]){
    if(tag[0]!=='r')continue;
    try{const url=endpoint(tag[1]);const mode=tag[2];if(mode!==undefined && mode!=='read' && mode!=='write')continue;
      entries.push({url,read:mode!=='write',write:mode!=='read'});
    }catch{}
  }
  const merged=new Map();for(const e of entries){const prior=merged.get(e.url)||{url:e.url,read:false,write:false};prior.read||=e.read;prior.write||=e.write;merged.set(e.url,prior)}
  return [...merged.values()];
}
export function planRelays({authorList=[],recipientLists=[],defaults=[],max=8}={}) {
  const author=authorList.filter(x=>x.write).map(x=>x.url);
  const recipients=recipientLists.flat().filter(x=>x.read).map(x=>x.url);
  return endpoints([...author,...recipients,...defaults], 'relay', 128).slice(0,max);
}
export async function relayInfo(url,{fetcher=fetch,signal}={}) {
  const target=endpoint(url);
  const http=new URL(target);http.protocol='https:';
  const response=await fetcher(http.href,{headers:{Accept:'application/nostr+json'},signal});
  if(!response.ok)throw new Error(`NIP-11 HTTP ${response.status}`);
  const body=await response.json();if(!body||Array.isArray(body)||typeof body!=='object')throw new Error('Bad NIP-11 response');return body;
}
