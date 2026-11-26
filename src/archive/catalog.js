/** Recovery archive catalog: bounded index, version lineage, and clone-aware search. */
export function buildArchiveCatalog(versions,{pages=[],jobs=[],settings=[]}={}){
  const bySite=new Map(),pageMap=new Map(pages.map(p=>[`${p.hash}\n${p.path}`,p])),jobsByHash=new Map(jobs.map(j=>[j.hash||j.id,j])),preferences=new Map(settings.map(s=>[s.id,s]));
  for(const v of versions){const group=bySite.get(v.site)||[];group.push(v);bySite.set(v.site,group)}
  const sites=[];
  for(const [id,list] of bySite){list.sort((a,b)=>b.event.created_at-a.event.created_at||a.id.localeCompare(b.id));const latest=list[0],files=latest.files||[],derived=files.map(f=>pageMap.get(`${f.hash}\n${f.path}`)).filter(Boolean);
    const title=latest.published?.title||derived.find(p=>p.data?.title)?.data.title||'Untitled site';
    const description=latest.published?.description||derived.find(p=>p.data?.description)?.data.description||'';
    sites.push({id,publisher:latest.event.pubkey,title,description,created:latest.event.created_at,versions:list.length,files:files.length,verifiedFiles:files.filter(f=>jobsByHash.get(f.hash)?.state==='complete').length,hidden:!!preferences.get('hidden:'+id)?.hidden,search:[id,title,description,latest.event.pubkey,...derived.map(x=>x.data?.text||'')].join(' ').toLowerCase()});
  }
  return {bySite,sites};
}
export function searchArchive(catalog,{query='',publisher='',sort='recent',offset=0,limit=40,includeHidden=false}={}){
  const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const all=catalog.sites.filter(s=>(includeHidden||!s.hidden)&&(!publisher||s.publisher===publisher)&&terms.every(q=>s.search.includes(q)));
  all.sort(sort==='title'?(a,b)=>a.title.localeCompare(b.title):sort==='files'?(a,b)=>b.files-a.files:(a,b)=>b.created-a.created);
  return {total:all.length,rows:all.slice(offset,offset+Math.min(100,Math.max(1,limit))).map(({search,...s})=>s)};
}
