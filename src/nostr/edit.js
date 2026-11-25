import {classifyEventStorage} from '../anchor/kinds.js';
import {eventTemplate} from './events.js';
import {verifiedCopy} from './history.js';
const dTag=tags=>tags.find(t=>t[0]==='d')?.[1]??'';
const countTags=tags=>{const m=new Map();for(const t of tags){const k=JSON.stringify(t);m.set(k,(m.get(k)||0)+1)}return m};
function missingTags(a,b){const counts=countTags(b);return a.filter(t=>{const k=JSON.stringify(t),n=counts.get(k)||0;if(n){counts.set(k,n-1);return false}return true})}
function objectFields(content){try{const value=JSON.parse(content);return value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value):[]}catch{return []}}
/** Review an exact signed baseline, without signing or deciding that the relay copy is current. */
export function reviewEventReplacement(baseline,template,pubkey){
  const previous=verifiedCopy(baseline),next=eventTemplate(structuredClone(template));
  const storage=classifyEventStorage(previous.kind);
  if(storage!=='replaceable'&&storage!=='addressable')throw new Error('Event is not replaceable');
  if(pubkey!==previous.pubkey||next.kind!==previous.kind)throw new Error('Replacement account or kind changed');
  if(storage==='addressable'&&dTag(next.tags)!==dTag(previous.tags))throw new Error('Replacement identifier changed');
  if(next.created_at<=previous.created_at)throw new Error('Replacement timestamp must be newer than baseline');
  const removedTags=missingTags(previous.tags,next.tags),addedTags=missingTags(next.tags,previous.tags);
  const removedProfileFields=next.kind===0?objectFields(previous.content).filter(k=>!objectFields(next.content).includes(k)):[];
  return {baselineId:previous.id,template:next,contentChanged:next.content!==previous.content,removedTags,addedTags,removedProfileFields};
}
/** Replace only explicitly owned tag names, preserving unknown tags and exact identity. */
export function prepareEventReplacement(baseline,{pubkey=baseline?.pubkey,content,replaceTags={},created_at=Math.floor(Date.now()/1000)}={}){
  const previous=verifiedCopy(baseline);
  if(!replaceTags||typeof replaceTags!=='object'||Array.isArray(replaceTags))throw new TypeError('Expected explicit tag replacement map');
  const names=Object.keys(replaceTags);
  if(classifyEventStorage(previous.kind)==='addressable'&&names.includes('d'))throw new Error('Cannot edit addressable identifier');
  const supplied=[];
  for(const name of names){const tags=replaceTags[name];if(!name||!Array.isArray(tags)||tags.some(t=>!Array.isArray(t)||t[0]!==name||t.some(v=>typeof v!=='string')))throw new TypeError('Invalid tag replacement: '+name);supplied.push(...tags)}
  const next=eventTemplate({kind:previous.kind,created_at,content:content??previous.content,tags:[...previous.tags.filter(t=>!names.includes(t[0])),...supplied]});
  return reviewEventReplacement(previous,next,pubkey);
}
