/** Bounded source comparison. No HTML rendering; preserves exact line endings and whitespace. */
export function compareMarkdown(base,other,{maxBytes=256*1024,maxCells=1000000}={}){
  if(typeof base!=='string'||typeof other!=='string')throw TypeError('Markdown strings required');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(maxCells)||maxCells<1||maxCells>4000000)throw RangeError('Invalid comparison budget');
  const encoder=new TextEncoder();
  if(base.length>maxBytes||other.length>maxBytes||encoder.encode(base).length>maxBytes||encoder.encode(other).length>maxBytes)throw RangeError('Markdown byte limit exceeded');
  const split=s=>s.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g)||[];
  const a=split(base),b=split(other),changes=[];
  const append=(kind,text)=>{const tail=changes.at(-1);if(tail?.kind===kind)tail.parts.push(text);else changes.push({kind,parts:[text]});};
  let prefix=0,suffix=0;
  while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
  while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
  const n=a.length-prefix-suffix,m=b.length-prefix-suffix;
  const exact=n===0||m===0||(n+1)*(m+1)<=maxCells;
  for(let i=0;i<prefix;i++)append('same',a[i]);
  let common=prefix+suffix;
  if(n&&m&&exact){
    const stride=m+1,dp=new Uint32Array((n+1)*stride);
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i*stride+j]=a[prefix+i]===b[prefix+j]?1+dp[(i+1)*stride+j+1]:Math.max(dp[(i+1)*stride+j],dp[i*stride+j+1]);
    let i=0,j=0;
    while(i<n||j<m){
      if(i<n&&j<m&&a[prefix+i]===b[prefix+j]){append('same',a[prefix+i]);i++;j++;common++;}
      else if(i<n&&(j===m||dp[(i+1)*stride+j]>=dp[i*stride+j+1]))append('removed',a[prefix+i++]);
      else append('added',b[prefix+j++]);
    }
  }else{
    for(let i=0;i<n;i++)append('removed',a[prefix+i]);
    for(let j=0;j<m;j++)append('added',b[prefix+j]);
  }
  for(let i=a.length-suffix;i<a.length;i++)append('same',a[i]);
  return {changed:base!==other,exact,similarity:a.length+b.length?2*common/(a.length+b.length):1,changes:changes.map(({kind,parts})=>({kind,text:parts.join('')}))};
}
