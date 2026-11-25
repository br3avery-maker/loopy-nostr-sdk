/** Recovered from MojiSurvivor moderation lists; portable NIP-19 parsing with checksum validation. */
const ABC='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const VALID_HEX=/^[a-f\d]{64}$/i;
function polymod(values){let chk=1;for(const v of values){const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^v;for(let i=0;i<5;i++)if((top>>>i)&1)chk^=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3][i]}return chk>>>0}
function expand(hrp){return [...hrp].map(c=>c.charCodeAt(0)>>>5).concat(0,[...hrp].map(c=>c.charCodeAt(0)&31))}
function toBytes(words){let acc=0,bits=0,out=[];for(const w of words){acc=(acc<<5)|w;bits+=5;while(bits>=8){bits-=8;out.push((acc>>>bits)&255)}}if(bits>=5||((acc<<(8-bits))&255))return null;return Uint8Array.from(out)}
function hex(buf){return Array.from(buf,b=>b.toString(16).padStart(2,'0')).join('')}
export function decodeNip19(value){
 if(typeof value!=='string')throw new TypeError('NIP-19 string required');const s=value.trim().replace(/^nostr:/i,'');
 if(s!==s.toLowerCase()&&s!==s.toUpperCase())throw Error('Mixed-case bech32 identifier');const t=s.toLowerCase(),p=t.lastIndexOf('1');
 if(p<=0||p+7>t.length||t.length>5000)throw Error('Invalid NIP-19 length');const hrp=t.slice(0,p),chars=t.slice(p+1);const words=[];
 for(const c of chars){let i=ABC.indexOf(c);if(i<0)throw Error('Invalid NIP-19 alphabet');words.push(i)}
 if(polymod([...expand(hrp),...words])!==1)throw Error('Invalid NIP-19 checksum');const raw=toBytes(words.slice(0,-6));if(!raw)throw Error('Invalid NIP-19 bits');
 if(hrp==='npub'||hrp==='note'){if(raw.length!==32)throw Error('NIP-19 public key/event ID must be 32 bytes');return {type:hrp,hex:hex(raw)}}
 if(hrp==='nprofile'||hrp==='nevent'||hrp==='naddr'){
  let i=0,pubkey=null,eventId=null,author=null,relays=[],identifier=null,kind=null;while(i<raw.length){if(i+2>raw.length)throw Error('Incomplete NIP-19 TLV');const tag=raw[i++],len=raw[i++];if(i+len>raw.length)throw Error('Truncated NIP-19 TLV');const val=raw.subarray(i,i+len);i+=len;
   if(tag===0){if(hrp==='naddr')identifier=new TextDecoder().decode(val);else if(len===32){if(hrp==='nevent')eventId=hex(val);else pubkey=hex(val)}}
   if(tag===1){const relay=new TextDecoder().decode(val);if(/^wss:\/\//.test(relay))relays.push(relay)}
   if(tag===2&&len===32){if(hrp==='naddr')pubkey=hex(val);else if(hrp==='nevent')author=hex(val);}
   if(tag===3&&len===4&&hrp!=='nprofile')kind=(new DataView(val.buffer,val.byteOffset,4)).getUint32(0,false);
  }
  if(hrp==='nevent'){if(!eventId)throw Error('NIP-19 missing event ID');return {type:hrp,hex:eventId,author,relays,identifier,kind};}
  if(!pubkey)throw Error('NIP-19 address missing pubkey');return {type:hrp,hex:pubkey,relays,identifier,kind};
 }
 throw Error('Unsupported NIP-19 prefix');
}
export function normalizePubkey(value){if(typeof value!=='string')return null;const s=value.trim().replace(/^nostr:/i,'');if(VALID_HEX.test(s))return s.toLowerCase();try{const d=decodeNip19(s);return ['npub','nprofile','naddr'].includes(d.type)?d.hex:null}catch{return null}}
export function normalizeEmojiHash(value){if(typeof value!=='string')return null;const t=value.trim().replace(/^sha256:/i,'').replace(/^#/,'');return VALID_HEX.test(t)?t.toLowerCase():null}
export function normalizePubkeyList(values){return [...new Set((Array.isArray(values)?values:[]).map(normalizePubkey).filter(Boolean))]}
export function normalizeHashList(values){return [...new Set((Array.isArray(values)?values:[]).map(normalizeEmojiHash).filter(Boolean))]}
