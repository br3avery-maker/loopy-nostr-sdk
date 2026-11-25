/** Conservative metadata extraction; does not execute unknown HTML. */
export function htmlMetadata(source){
  if(typeof source!=='string')throw new TypeError('HTML string required');
  const html=source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ');
  const read=(pattern)=>html.match(pattern)?.[1]?.replace(/&(?:amp|lt|gt|quot|#39);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"})[s]).trim()||'';
  return {title:read(/<title\b[^>]*>([\s\S]*?)<\/title>/i).slice(0,250),description:read(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i).slice(0,1200),headings:[...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].slice(0,100).map(m=>m[1].replace(/<[^>]+>/g,'').trim()).filter(Boolean)};
}
