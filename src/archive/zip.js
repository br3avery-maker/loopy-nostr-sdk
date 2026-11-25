import {bytes,encode} from '../core/bytes.js';
import {nsitePath} from '../core/urls.js';
const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0});
export function crc32(input){let crc=0xffffffff;for(const b of bytes(input))crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0}
const u16=(d,o)=>d.getUint16(o,true),u32=(d,o)=>d.getUint32(o,true);
const text=new TextDecoder('utf-8',{fatal:true});
/** Strict central-directory ZIP reader (stored and DEFLATE; no ZIP64, encryption or symlink entries). */
export async function readZip(input,{maxFiles=20000,maxOutputBytes=128*1024*1024,maxRatio=400,inflate}={}){
  const raw=bytes(input),d=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),length=raw.byteLength;
  let end=-1;for(let i=length-22;i>=Math.max(0,length-65557);i--){if(u32(d,i)===0x06054b50&&i+22+u16(d,i+20)===length){end=i;break;}}
  if(end<0)throw new Error('ZIP end-of-central-directory not found');
  if(u16(d,end+4)!==0||u16(d,end+6)!==0)throw new Error('Multipart ZIP unsupported');
  const count=u16(d,end+10),csize=u32(d,end+12),coff=u32(d,end+16);
  if(count>maxFiles||u16(d,end+8)!==count||coff+csize>end)throw new Error('Bad ZIP directory bounds');
  const seen=new Set(),out=Object.create(null);let pos=coff,total=0;
  for(let i=0;i<count;i++){
    if(pos+46>coff+csize||u32(d,pos)!==0x02014b50)throw new Error('Invalid ZIP central header');
    const flag=u16(d,pos+8),method=u16(d,pos+10),expectedCRC=u32(d,pos+16),csize2=u32(d,pos+20),size=u32(d,pos+24),fn=u16(d,pos+28),extra=u16(d,pos+30),comment=u16(d,pos+32),external=u32(d,pos+38),offset=u32(d,pos+42),endname=pos+46+fn;
    if(endname+extra+comment>coff+csize)throw new Error('ZIP entry metadata out of bounds');
    const name=text.decode(raw.subarray(pos+46,endname));pos=endname+extra+comment;
    if(name.endsWith('/'))continue;
    const path=nsitePath(name).slice(1);
    const unixMode=(external>>>16)&0xf000;
    if(unixMode===0xa000 || (flag&1) || (flag&0x40) || ![0,8].includes(method))throw new Error('ZIP member unsupported or unsafe');
    if(seen.has(path))throw new Error('Duplicate ZIP member '+path);seen.add(path);
    total+=size;if(total>maxOutputBytes||size>Math.max(csize2,1)*maxRatio)throw new Error('ZIP expansion budget exceeded');
    if(offset+30>length||u32(d,offset)!==0x04034b50)throw new Error('ZIP local header missing');
    const dataOffset=offset+30+u16(d,offset+26)+u16(d,offset+28);
    if(dataOffset+csize2>coff)throw new Error('ZIP payload out of bounds');
    const encoded=raw.subarray(dataOffset,dataOffset+csize2);
    let value;
    if(method===0)value=encoded;
    else if(inflate)value=await inflate(encoded);
    else if(typeof process!=='undefined'&&process.versions?.node){const {inflateRawSync}=await import('node:zlib');value=inflateRawSync(encoded,{maxOutputLength:maxOutputBytes});}
    else throw new Error('Deflate provider required for this browser; provide inflate(bytes)');
    if(value.length!==size||crc32(value)!==expectedCRC)throw new Error('ZIP CRC or size mismatch '+path);
    out[path]=new Uint8Array(value);
  }
  return out;
}
/** Deterministic standards-compliant ZIP writer (stored method) with CRC and central directory. */
export function writeZip(fileMap,{maxFiles=20000,maxBytes=128*1024*1024}={}){
  const sorted=Object.entries(fileMap).map(([name,data])=>({name:nsitePath(name).slice(1),data:bytes(data)})).sort((a,b)=>a.name.localeCompare(b.name));
  if(sorted.length>maxFiles)throw new RangeError('Too many ZIP entries');
  const used=new Set();let cursor=0,total=0;const sections=[],cent=[];
  const h=(size)=>new Uint8Array(size);const put16=(d,o,v)=>new DataView(d.buffer).setUint16(o,v,true),put32=(d,o,v)=>new DataView(d.buffer).setUint32(o,v,true);
  const join=(parts)=>{const size=parts.reduce((n,a)=>n+a.length,0),out=new Uint8Array(size);let p=0;for(const a of parts){out.set(a,p);p+=a.length}return out};
  for(const f of sorted){if(used.has(f.name))throw new Error('Duplicate ZIP path');used.add(f.name);total+=f.data.length;if(total>maxBytes)throw new RangeError('ZIP exceeds byte budget');const name=encode(f.name),crc=crc32(f.data);if(name.length>65535)throw new RangeError('ZIP name too long');
    const local=h(30);put32(local,0,0x04034b50);put16(local,4,20);put16(local,6,0x800);put32(local,14,crc);put32(local,18,f.data.length);put32(local,22,f.data.length);put16(local,26,name.length);
    sections.push(local,name,f.data);
    const central=h(46);put32(central,0,0x02014b50);put16(central,4,20);put16(central,6,20);put16(central,8,0x800);put32(central,16,crc);put32(central,20,f.data.length);put32(central,24,f.data.length);put16(central,28,name.length);put32(central,42,cursor);cent.push(central,name);
    cursor+=local.length+name.length+f.data.length;
  }
  const centralBytes=join(cent);const footer=h(22);put32(footer,0,0x06054b50);put16(footer,8,sorted.length);put16(footer,10,sorted.length);put32(footer,12,centralBytes.length);put32(footer,16,cursor);
  return join([...sections,centralBytes,footer]);
}
