/** Nsite campaign detection translated from Pretend-Internet archive and piShell Kotlin; no blanket keyword censorship. */
export const CAMPAIGN_ROLE_OPENERS=Object.freeze(['Independent web researcher','Practical technology researcher','Community writer sharing','Online publishing specialist','Digital resources editor']);
const PROMISE=/\b(?:sharing|offering|providing|curated|curating|resources|insights|articles|guides|recommendations?)\b/iu;
const URL_LIKE=/(?:https?:\/\/|www\.)\S+/iu;
const DOMAIN=/\b[a-z\d][a-z\d-]*(?:\.[a-z\d][a-z\d-]*)*\.[a-z]{2,24}\b/giu;
const FILE=/\.(?:html?|xhtml|css|mjs|cjs|jsx?|tsx?|jsonl?|txt|md|markdown|png|jpe?g|webp|gif|svg|ico|pdf|epub|mobi|zip|gz|tgz|tar|rar|7z|wav|mp3|m4a|ogg|flac|mp4|mov|webm|avi|xml|rss|atom|csv|tsv|wasm|apk|aab|exe|msi|dmg|iso|ya?ml|toml|lock|py|rb|rs|cpp|hpp|java|kt|swift|dart|ps1|sh|ipynb|sql|sqlite|log)$/iu;
const PIPE=/(?:\|\s*(?:a note about|una nota sobre|un billet sur|eine notiz über|uma nota sobre|una nota su|notatka o|een notitie over|notes on|practical notes on))\b/iu;
function norm(s){return String(s||'').replace(/^\s*[\uFEFF\u200B\u200C\u200D]+/u,'').replace(/\s+/gu,' ').trim()}
function link(s){if(URL_LIKE.test(s))return true;for(const m of s.matchAll(DOMAIN))if(!FILE.test(m[0]))return true;return false}
export function campaignMatch(value){const text=norm(value);const lower=text.toLowerCase();for(const prefix of CAMPAIGN_ROLE_OPENERS){const p=prefix.toLowerCase();if(lower.startsWith(p)&&(!lower[p.length]||!/[\p{L}\p{N}]/u.test(lower[p.length]))&&PROMISE.test(text.slice(p.length))&&link(text))return {prefix,reasons:['role-phrase','resource-promise','external-link']}}return null}
/** Distinguish confirmed signatures, suspicious near-matches, and clear. Raw records remain available. */
export function inspectNsiteSpam(site,{knownCampaigns=true}={}){
 const d=norm(site.description).slice(0,4096),title=norm(site.title).slice(0,512),kind=site.kind,dTag=site.dTag||site.identifier;
 const campaign=knownCampaigns?campaignMatch(d):null;
 const structural=(Number(site.pathCount)===1&&title.includes('|')&&(kind===15128||dTag==='root')&&link(title+' '+d));
 const pipe=PIPE.test(title),promotionalLink=link(d)&&/\b(?:resources|insights|guides|recommendations|notes)\b/i.test(d);
 const reasons=[...(campaign?campaign.reasons:[]),...(structural?['four-signal-structure']:[]),...(pipe?['multilingual-pipe-template']:[]),...(promotionalLink?['promotional-link']:[])];
 return {status:campaign?'confirmed':reasons.length?'review':'clear',reasons:[...new Set(reasons)],evidence:{campaign,structural}};
}
/** Cluster repeated templates by multiple independent authors; a *review signal*, not an automatic global ban. */
export function clusterNsiteSpam(sites,{minDistinctAuthors=2}={}){
 if(!Array.isArray(sites))throw TypeError('Expected site array');const groups=new Map();
 for(const s of sites){const pubkey=String(s.pubkey||s.authorPubkey||'').toLowerCase();if(!/^[0-9a-f]{64}$/.test(pubkey)||s.isInstalled||s.pinned)continue;
  const description=norm(s.description).toLowerCase().slice(0,280).replace(/https?:\/\/\S+/g,'<domain>').replace(/\b\d+\b/g,'<n>');
  const tokens=description.split(/\s+/).filter(Boolean);if(tokens.length<5||description==='decentralized nostr web manifest'||description==='nostr web applet')continue;
  const key=tokens.slice(0,6).join(' ');if(!groups.has(key))groups.set(key,{template:key,authors:new Set(),ids:[]});const g=groups.get(key);g.authors.add(pubkey);g.ids.push(s.id);
 }
 return [...groups.values()].filter(g=>g.authors.size>=minDistinctAuthors).map(g=>({template:g.template,distinctAuthors:g.authors.size,ids:g.ids,reason:'cross-account-template',status:'review'}));
}
export function filterNsites(sites,{bannedPubkeys=[],hideConfirmed=true,hideSuspected=false,ownPubkey}={}){
 const ban=new Set(bannedPubkeys.map(x=>x.toLowerCase()));const clusters=clusterNsiteSpam(sites);const flagged=new Set(clusters.flatMap(g=>g.ids));const visible=[],hidden=[],decisions=[];
 for(const s of sites){const owned=Boolean(s.isInstalled||s.pinned||(ownPubkey&&(s.pubkey===ownPubkey||s.authorPubkey===ownPubkey)));const pubkey=String(s.pubkey||s.authorPubkey||'').toLowerCase();const spam=inspectNsiteSpam(s);const blocked=ban.has(pubkey);const hide=!owned&&(blocked||(hideConfirmed&&spam.status==='confirmed')||(hideSuspected&&flagged.has(s.id)));const decision={id:s.id,hidden:hide,status:blocked?'blocked':spam.status,reasons:[...(blocked?['explicit-publisher-ban']:[]),...spam.reasons,...(flagged.has(s.id)?['cross-account-template']:[])]};decisions.push(decision);(hide?hidden:visible).push(s)}
 return {visible,hidden,decisions,clusters,rawCount:sites.length};
}
