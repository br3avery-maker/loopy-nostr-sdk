/** Nsite Loopy SDK public typed facade (JS runtime; declarations independently typechecked). */
import * as Intelligence from './intelligence/index.js';
export { Intelligence };
export type Hex = string;
export type Endpoint = string;
export interface UnsignedEvent {kind:number;created_at:number;content:string;tags:string[][]}
export interface SignedEvent extends UnsignedEvent {id:Hex;pubkey:Hex;sig:Hex}
export interface Signer {getPublicKey():Promise<Hex>;signEvent(e:UnsignedEvent):Promise<SignedEvent>;close?():Promise<void>}
export interface RelayReceipt {relay:string;eventId:Hex;accepted:true;readback:true}
export interface PublishReceipts {status?:string;verified:RelayReceipt[];failed?:Array<{relay:string;error:string}>}
export interface FileEntry {path:string;hash:Hex;size:number;bytes:Uint8Array}
export interface PreparedFiles {entries:FileEntry[];aggregate:Hex;totalBytes:number}
export interface ManifestRecord {pubkey:Hex;kind:number;created_at:number;identifier:string;aggregate:Hex;files:Array<{path:string;hash:Hex}>;url:string;eventId:Hex;verified:boolean}
export interface StorageAdapter {get(key:string):Promise<unknown>;set(key:string,value:unknown):Promise<void>;delete(key:string):Promise<void>;keys():Promise<string[]>}
export type FileMap=Record<string,string|Uint8Array|ArrayBuffer>;
export interface RelayListEntry {url:string;read:boolean;write:boolean}
export interface SDKOptions {relays?:string[];server?:string;signer?:Signer;storage?:StorageAdapter;Socket?:any;fetcher?:typeof fetch;clock?:()=>number}
export interface EventReplacementReview {baselineId:Hex;template:UnsignedEvent;contentChanged:boolean;removedTags:string[][];addedTags:string[][];removedProfileFields:string[]}
export interface PublicationPlanOptions {pubkey:Hex;server:Endpoint;relays:Endpoint[];identifier?:string;title?:string;description?:string;created_at?:number;baseline?:SignedEvent|null;approvedPlan?:Hex}
export interface PublicationPlan {schema:'nsite-publication-plan/1';id:Hex;pubkey:Hex;identifier:string;server:Endpoint;relays:Endpoint[];baselineId:Hex|null;baselineStatus:'observed'|'unknown';aggregate:Hex;totalBytes:number;files:Array<{path:string;hash:Hex;size:number}>;template:UnsignedEvent;changes:Array<{path:string;change:'added'|'modified'|'deleted';from?:Hex;to?:Hex}>;removedTags:string[][];addedTags:string[][]}
export interface PublicationOptions extends PublicationPlanOptions {signer:Signer;allowFileRemovals?:boolean;resolveCurrent?:(request:{pubkey:Hex;kind:number;identifier:string;relays:Endpoint[];signal?:AbortSignal})=>Promise<SignedEvent|null>;uploader?:(data:Uint8Array,options:object)=>Promise<{hash:Hex;verified:boolean}>;publisher?:(event:SignedEvent,relays:string[],options?:object)=>Promise<PublishReceipts>;checkpoint?:(job:object)=>Promise<void>|void;signal?:AbortSignal;Socket?:any;fetcher?:typeof fetch}
export namespace Core {
  function encode(value:string):Uint8Array;
  function bytes(value:string|Uint8Array|ArrayBuffer):Uint8Array;
  function hex(value:Uint8Array):string;
  function unhex(value:string):Uint8Array;
  function sha256(value:string|Uint8Array|ArrayBuffer,options?:object):Promise<Hex>;
  function toBase64Url(value:string|Uint8Array|ArrayBuffer):string;
  function endpoint(input:string,type?:'relay'|'blossom'):string;
  function endpoints(values:string[],type?:'relay'|'blossom',max?:number):string[];
  function nsitePath(input:string):string;
  function slug(value:string):string;
  function normalizeOptions(options?:SDKOptions):SDKOptions;
}
/** One verified event sighting; seenAt is the client's observation time, not created_at. */
export interface EventObservation {event:SignedEvent;relay:Endpoint;seenAt:number}
export interface EventRelaySighting {relay:Endpoint;firstSeenAt:number;lastSeenAt:number}
export interface EventHistoryRecord {event:SignedEvent;identity:string;relays:EventRelaySighting[]}
export interface HistoryFilter {kinds:number[];ids?:Hex[];authors?:Hex[];since?:number;until?:number;[tag:`#${string}`]:string[]|undefined}
export interface HistoryCursor {relay:Endpoint;scope:string;watermark:number|null;window:null|{since:number;until:number;nextUntil:number;newestAt:number|null}}
export type HistoryStatus='window-read'|'partial'|'boundary-stalled'|'failed'|'cancelled'|'not-yet-in-window';
export interface HistorySyncResult {observations:EventObservation[];cursors:Record<Endpoint,HistoryCursor>;relays:Array<{relay:Endpoint;pages:number;status:HistoryStatus;error:string|null}>}
export interface HistorySyncOptions {relays:Endpoint[];filter:HistoryFilter;cursors?:Record<Endpoint,HistoryCursor>;pageSize?:number;boundaryLimit?:number;maxPages?:number;now?:number;timeoutMs?:number;signal?:AbortSignal;Socket?:any;query?:(url:Endpoint,filter:HistoryFilter&{since:number;until:number;limit:number},options:{signal?:AbortSignal;timeoutMs:number;maxEvents:number;Socket?:any})=>Promise<SignedEvent[]>}
/** Advisory, offline event-specific relay routing. Explicit network/signing authorization remains separate. */
export interface RelayDeliveryOptions {
  signedLists?:SignedEvent[]; pinned?:Endpoint[]; defaults?:Endpoint[]; allowedRelays?:Endpoint[]; entitledRelays?:Endpoint[];
  relayPolicies?:Array<{relay:Endpoint;observedAt:number;document:Record<string,unknown>}>;
  now?:number; policyTTL?:number; redundancy?:number; maxCandidates?:number; visibility?:'public'|'private'; authPubkey?:Hex; authAvailable?:boolean;
}
export interface RelayDeliveryCandidate {relay:Endpoint;requiresAuthentication:boolean;policyObservedAt:number|null;warnings:string[]}
export interface RelayDeliveryPlan {
  eventId:Hex;kind:number;storageClass:string;frameBytes:number;visibility:'public'|'private';protectedEvent:boolean;at:number;
  groups:Array<{id:string;required:number;selected:RelayDeliveryCandidate[];fallbacks:RelayDeliveryCandidate[];omitted:number;status:'recipient-list-missing'|'insufficient-candidates'|'planned-unverified'}>;
  excluded:Array<{group:string;relay:Endpoint;reasons:string[]}>;
}
export interface RelayDeliveryReceipt {relay:Endpoint;eventId:Hex;accepted:boolean;readback?:boolean}
export interface RelayDeliverySummary {eventId:Hex;status:'verified'|'accepted-ephemeral'|'partial-or-failed';groups:Array<{id:string;required:number;accepted:Endpoint[];delivered:Endpoint[];status:'verified'|'accepted-ephemeral'|'accepted-incomplete'|'not-delivered'}>}
export namespace Nostr {
  function planRelayDelivery(event:SignedEvent,options?:RelayDeliveryOptions):RelayDeliveryPlan;
  function summarizeRelayDelivery(plan:RelayDeliveryPlan,receipts?:RelayDeliveryReceipt[]):RelayDeliverySummary;

  function reviewEventReplacement(baseline:SignedEvent,template:UnsignedEvent,pubkey:Hex):EventReplacementReview;
  function prepareEventReplacement(baseline:SignedEvent,options?:{pubkey?:Hex;content?:string;replaceTags?:Record<string,string[][]>;created_at?:number}):EventReplacementReview;
  function eventIdentity(event:SignedEvent):string;
  function collectEventObservations(observations:EventObservation[]):{records:EventHistoryRecord[];current:SignedEvent[];rejected:Array<{index:number;error:string}>};
  function syncEventHistory(options:HistorySyncOptions):Promise<HistorySyncResult>;
  function relayAuthTemplate(options:{challenge:string;relay:string;created_at?:number}):UnsignedEvent;
  function httpAuthHeader(options:{url:string;method:string;signer:Signer;pubkey:Hex;created_at?:number}):Promise<string>;
  function encryptionAdapter(signer:{nip44?:{encrypt(peer:string,plaintext:string):Promise<string>;decrypt(peer:string,ciphertext:string):Promise<string>}}):{encrypt(peer:string,plaintext:string):Promise<string>;decrypt(peer:string,ciphertext:string):Promise<string>};
  function generateSecretKey():Uint8Array;
  function getPublicKey(secret:Uint8Array):Hex;
  function npubEncode(pubkey:Hex):string;
  function finalizeEvent(template:UnsignedEvent,secret:Uint8Array):SignedEvent;
  function verifyEvent(event:SignedEvent):boolean;
  function eventTemplate(input?:Partial<UnsignedEvent>):UnsignedEvent;
  function assertSignedEvent(event:SignedEvent):SignedEvent;
  function checkedSign(signer:Signer,template:UnsignedEvent,pubkey:Hex):Promise<SignedEvent>;
  function browserSigner(provider?:Signer):Signer;
  function bunkerSigner(uri:string,options?:object):Promise<Signer&{connect():Promise<Hex>;close():Promise<void>}>;
  function nostrConnectRequest(options:{relays:string[];name?:string;perms?:string[];secret?:string;clientSecret?:Uint8Array}):{uri:string;mode:'nip46';start(signal?:AbortSignal):Promise<Signer>};
  function connectIdentity(signer:Signer):Promise<{pubkey:Hex;signer:Signer}>;
  function androidIntent(input:{type?:'get_public_key'|'sign_event';requestId:string;event?:UnsignedEvent;currentPubkey?:Hex;callbackUrl?:string}):string;
  function verifyAndroidResult(input:{requestId:string;returnedId:string;event:SignedEvent;template:UnsignedEvent;expectedPubkey:Hex;rejected?:boolean}):SignedEvent;
  function relayList(event:SignedEvent):RelayListEntry[];
  function planRelays(options:{authorList?:RelayListEntry[];recipientLists?:RelayListEntry[][];defaults?:string[];max?:number}):string[];
  function relayInfo(url:string,options?:object):Promise<Record<string,unknown>>;
  function discoverRelays(pubkey:Hex,options?:RetrievalTransport&{bootstrap?:string[];defaults?:string[];max?:number}):Promise<{status:string;records:RelayListEntry[];relays:string[];sourceEvent:string|null;errors:Array<{relay:string;error:string}>}>;
  function blossomServers(event:SignedEvent):string[];
  function discoverBlossom(pubkey:Hex,options?:RetrievalTransport&{bootstrap?:string[]}):Promise<{sourceEvent:string|null;servers:string[];verified:boolean;errors:Array<{relay:string;error:string}>}>;
  function queryRelay(url:string,filter:object,options?:{Socket?:any;timeoutMs?:number;signal?:AbortSignal;verify?:boolean;maxEvents?:number}):Promise<SignedEvent[]>;
  function publishRelay(url:string,event:SignedEvent,options?:{Socket?:any;timeoutMs?:number;signal?:AbortSignal;verify?:boolean}):Promise<RelayReceipt>;
  function publishMany(event:SignedEvent,relays:string[],options?:{writer?:(url:string,event:SignedEvent,options:object)=>Promise<RelayReceipt>}):Promise<PublishReceipts>;
  function textNote(content:string,options?:{replyTo?:SignedEvent;created_at?:number}):UnsignedEvent;
  function reaction(target:SignedEvent,emoji?:string,options?:{created_at?:number}):UnsignedEvent;
  function publishTemplate(template:UnsignedEvent,options:{signer:Signer;pubkey:Hex;relays:string[];publisher?:(event:SignedEvent,relays:string[])=>Promise<PublishReceipts>}):Promise<{event:SignedEvent;receipts:PublishReceipts}>;
  function fetchFeed(options:{authors:Hex[];kinds?:number[];relays:string[];limit?:number;query?:(url:string,filter:object)=>Promise<SignedEvent[]>}):Promise<{events:SignedEvent[];failed:Array<{relay:string;error:string}>;status:string}>;
  function parseProfile(event:SignedEvent):Record<string,string|number>;
  function fetchProfiles(options:{pubkeys:Hex[];relays:string[];query?:(url:string,filter:object)=>Promise<SignedEvent[]>}):Promise<{profiles:Map<Hex,Record<string,string|number>>;failed:object[];status:string}>;
}
export interface RetrievalError {stage:string;relay?:Endpoint;error:string}
export interface RetrievalTransport {signal?:AbortSignal;timeoutMs?:number;Socket?:any;query?:(url:Endpoint,filter:object,options?:{signal?:AbortSignal;timeoutMs?:number;Socket?:any;maxEvents?:number})=>Promise<SignedEvent[]>}
export interface ManifestResolveOptions extends RetrievalTransport {identifier?:string;bootstrap?:Endpoint[];relays?:Endpoint[];storage?:StorageAdapter;mode?:'cache-first'|'refresh'|'offline';ttlSeconds?:number;now?:number}
export interface ManifestResolution {status:'resolved'|'cached'|'stale'|'not-found'|'unreachable'|'invalid';event:SignedEvent|null;manifest:ManifestRecord|null;checkedAt:number|null;queriedRelays:Endpoint[];errors:RetrievalError[]}
export interface ManifestPathMatch {path:string;hash:Hex;status:200|404}
export interface SiteFileOptions extends RetrievalTransport {now?:number;servers?:Endpoint[];relays?:Endpoint[];fetcher?:typeof fetch;maxBytes?:number;store?:Pick<ReturnType<typeof Archive.contentStore>,'get'|'put'>}
export interface VerifiedSiteFile extends ManifestPathMatch {mediaType:string;manifest:ManifestRecord;eventId:Hex;source:'cache'|'blossom';data:Uint8Array;server:Endpoint|null;errors:RetrievalError[]}
export namespace Nsite {
  function resolveNsiteManifest(pubkey:Hex,options?:ManifestResolveOptions):Promise<ManifestResolution>;
  function resolveManifestPath(manifest:ManifestRecord,requestPath:string):ManifestPathMatch|null;
  function loadNsiteFile(event:SignedEvent,path:string,options?:SiteFileOptions):Promise<VerifiedSiteFile|null>;
  function planNsitePublication(files:FileMap,options:PublicationPlanOptions):Promise<PublicationPlan>;
  const NSITE_ROOT_KIND:15128;
  const NSITE_NAMED_KIND:35128;
  function nsiteAddress(pubkey:Hex,options?:{identifier?:string;gateway?:string}):string;
  function prepareManifestFiles(files:FileMap,options?:{maxFiles?:number;maxBytes?:number}):Promise<PreparedFiles>;
  function manifestTemplate(prepared:PreparedFiles,options?:{identifier?:string;server?:string;title?:string;description?:string;created_at?:number}):UnsignedEvent;
  function parseManifest(event:SignedEvent,options?:{verify?:boolean;now?:number}):Promise<ManifestRecord>;
  function compareFiles(before:FileMap,after:FileMap):Promise<object[]>;
  function mediaType(path:string):string;
  function normalizeFileMap(input:FileMap):Record<string,Uint8Array>;
  function publishNsite(files:FileMap,options:PublicationOptions):Promise<{job:object;event:SignedEvent;manifest:ManifestRecord;receipts:PublishReceipts}>;
}
export namespace Blossom {
  function blossomAuthHeader(event:SignedEvent):string;
  function blossomUploadAuth(options:{hash:Hex;server:string;expiresIn?:number;now?:number}):UnsignedEvent;
  function uploadVerified(data:string|Uint8Array,options:{server:string;signer:Signer;pubkey:Hex;path?:string;fetcher?:typeof fetch;signal?:AbortSignal}):Promise<{hash:Hex;size:number;server:string;verified:true;url:string}>;
  function fetchVerified(hash:Hex,options:{servers:string[];fetcher?:typeof fetch;signal?:AbortSignal;timeoutMs?:number;maxBytes?:number}):Promise<{server:string;data:Uint8Array;hash:Hex;failed:Array<{error:string}>}>;
}
export interface RevisionRecord {schema:'nostr-revision/1';coordinate:string;eventId:Hex;hash:Hex;size:number}
export interface SnapshotRecord {event:SignedEvent;coordinate:string;snapshotId:Hex;archivist:Hex}
export interface MarkdownSourceComparison {changed:boolean;exact:boolean;similarity:number;changes:Array<{kind:'same'|'added'|'removed';text:string}>}
export namespace Archive {
  const SNAPSHOT_KIND:1349;
  function snapshotTemplate(event:SignedEvent,options?:{created_at?:number;maxBytes?:number}):UnsignedEvent;
  function unwrapSnapshot(event:SignedEvent,options?:{maxBytes?:number;expectedCoordinate?:string}):SnapshotRecord;
  function archiveRevision(event:SignedEvent,store:ReturnType<typeof contentStore>,options?:{maxBytes?:number}):Promise<RevisionRecord>;
  function restoreRevision(record:RevisionRecord,store:ReturnType<typeof contentStore>,options?:{maxBytes?:number}):Promise<SignedEvent>;
  function compareMarkdown(base:string,other:string,options?:{maxBytes?:number;maxCells?:number}):MarkdownSourceComparison;
  function crc32(data:string|Uint8Array):number;
  const GEAR_PROFILE: Readonly<{id:string;min:number;avg:number;max:number}>;
  function gearChunks(data:Uint8Array):Uint8Array[];
  function chunkManifest(data:Uint8Array,options?:{hash?:(data:Uint8Array)=>Promise<Hex>}):Promise<{profile:string;size:number;hash:Hex;chunks:Array<{hash:Hex;size:number}>}>;
  function restoreChunkManifest(manifest:{profile:string;size:number;hash:Hex;chunks:Array<{hash:Hex;size:number}>},read:(hash:Hex)=>Promise<Uint8Array>,options?:object):Promise<Uint8Array>;
  function readZip(data:Uint8Array,options?:{maxFiles?:number;maxOutputBytes?:number;maxRatio?:number;inflate?:(data:Uint8Array)=>Promise<Uint8Array>}):Promise<Record<string,Uint8Array>>;
  function writeZip(files:FileMap,options?:{maxFiles?:number;maxBytes?:number}):Uint8Array;
  function contentStore(storage?:StorageAdapter):{put(data:string|Uint8Array):Promise<{hash:Hex;size:number}>;get(hash:Hex):Promise<Uint8Array|null>;verify(hash:Hex):Promise<boolean>;saveManifest(id:string,manifest:object):Promise<void>;loadManifest(id:string):Promise<unknown>;keys():Promise<string[]>};
  function diffVersions(a:{files:Array<{path:string;hash:Hex}>},b:{files:Array<{path:string;hash:Hex}>}):object[];
  function materializeVersion(manifest:{files:Array<{path:string;hash:Hex}>},store:ReturnType<typeof contentStore>,options?:{maxFiles?:number;maxBytes?:number}):Promise<Record<string,Uint8Array>>;
  function groupVersions(versions:object[]):Map<string,object[]>;
  function buildArchiveCatalog(versions:object[],options?:object):object;
  function searchArchive(catalog:object,options?:object):{total:number;rows:object[]};
}
export namespace Directory {
  function emptyState():any;
  function validateRules(rules:object[]):object[];
  function validateCatalog(input:object):object[];
  function validateWorkspace(workspace:object,sites:object[]):object;
  function publicCatalog(sites:object[],state:object,group?:string):object[];
  function exportCatalog(sites:object[],state:object):object;
  function directoryRows(sites:object[],state:object,options?:object):object[];
  function select(sites:object[],state:object,options?:object):object[];
  function patch(state:object,ids:string[],changes:object):void;
  function bulkGroup(state:object,ids:string[],group:string,remove?:boolean):void;
  function stackSites(state:object,ids:string[],meta?:{title?:string;description?:string}):object;
  function unstack(state:object,ids:string[],remember?:boolean):void;
  function publisherCounts(sites:object[],state:object):Map<string,number>;
  function similarityKey(site:object):string;
  function htmlMetadata(source:string):{title:string;description:string;headings:string[]};
  function ageSeconds(value:string):number|null;
  const defaultRules:object[];
  function effective(site:object,state:object):object;
  function groupState(state:object,ids:string[]):string;
  function matches(site:object,rule:object):boolean;
  function membership(state:object):Map<string,object>;
  function moveQueue(state:object,delta:number):unknown;
  function publisherKey(site:object):string;
  function reasons(site:object,state:object):string[];
  function safeImage(value:unknown):string;
  function safeURL(value:string):string;
  function setQueue(state:object,ids:string[],append?:boolean):void;
  function toggleState(values:boolean[]):string;
  function upgrade(state:object):object;
  const VERSION:number;

  const SORTS:Record<string,string>;
}
export namespace Storage {
  function memoryStore(seed?:Record<string,unknown>):StorageAdapter;
  function indexedDbStore(options?:{name?:string;store?:string;indexedDBProvider?:IDBFactory}):StorageAdapter;
}
export namespace Adapters {
  function browserEnvironment(options?:object):{signer:Signer|null;storage:StorageAdapter|null;Socket:any;fetcher:typeof fetch};
  function androidHandoff(options:{launch:(uri:string)=>Promise<void>;onReturn:(requestId:string)=>Promise<{id:string;event:SignedEvent;rejected?:boolean}>}):{sign(options:{requestId:string;event:UnsignedEvent;expectedPubkey:Hex}):Promise<SignedEvent>};
}
export namespace Moderation {
  const CAMPAIGN_ROLE_OPENERS:readonly string[];
  const MOJI_CURATOR_BLOCKLIST_VERSION:string;
  const BUILT_IN_NSFW_BAN_PUBKEYS:readonly Hex[];
  const BUILT_IN_NSFW_MEDIA_URLS:readonly string[];
  const BUILT_IN_NSFW_BLOB_HASHES:readonly Hex[];
  function decodeNip19(value:string):{type:string;hex:Hex;author?:Hex|null;relays?:string[];identifier?:string|null;kind?:number|null};
  function normalizePubkey(value:string|null|undefined):Hex|null;
  function normalizeEmojiHash(value:string|null|undefined):Hex|null;
  function normalizePubkeyList(values:readonly string[]):Hex[];
  function normalizeHashList(values:readonly string[]):Hex[];
  function parseCuratorBlocklist(raw:string):{schema:string;pubkeys:Hex[];emojiHashes:Hex[];mediaUrls:string[]};
  function parseNip51MuteList(event:SignedEvent):{pubkey:Hex;pubkeys:Hex[];eventId:Hex;createdAt:number};
  function muteListTemplate(pubkeys:readonly string[],options?:{created_at?:number}):UnsignedEvent;
  function mergeBlocklists(...lists:object[]):{pubkeys:Hex[];emojiHashes:Hex[];mediaUrls:string[]};
  function isEmojiAllowed(candidate:{source?:string;packAuthor?:string;hash?:string;emojiKey?:string},policy?:object):boolean;
  function campaignMatch(description:string):{prefix:string;reasons:string[]}|null;
  function inspectNsiteSpam(site:object,options?:{knownCampaigns?:boolean}):{status:'confirmed'|'review'|'clear';reasons:string[];evidence:object};
  function clusterNsiteSpam(sites:object[],options?:{minDistinctAuthors?:number}):object[];
  function filterNsites(sites:object[],options?:{bannedPubkeys?:Hex[];hideConfirmed?:boolean;hideSuspected?:boolean;ownPubkey?:Hex}):{visible:object[];hidden:object[];decisions:object[];clusters:object[];rawCount:number};
}
export namespace Moji {
  function extractEmojiHash(url:string):Promise<Hex>;
  function sanitizeEmojiShortcode(value:string):string;
  function buildStableEmojiKey(url:string,source?:'nip30'|'reserve',hashOverride?:Hex):Promise<string>;
  function deriveEmojiStatsFromHash(hash:Hex):{hp:number;speed:number;damage:number;behaviorType:number;behaviorName:string;expValue:number;mojoValue:number;powerRating:number;tier:'Common'|'Rare'|'Epic'|'Apex'};
  function deriveEmojiStats(options:{shortcode:string;url:string;source?:'nip30'|'reserve';hashOverride?:Hex}):Promise<object>;
  function parseNip30Event(event:SignedEvent,options?:{policy?:object;max?:number}):Promise<{eventId:Hex;pubkey:Hex;title:string;kind:number;emojis:object[];excluded:object[];unresolvedReferences:string[]}>;
  function collectNip30Emojis(events:SignedEvent[],options?:{policy?:object;max?:number}):Promise<{emojis:object[];rejected:object[];unresolvedReferences:string[]}>;
}
export namespace Anchor {
  function sanitizePublicSession(session:object):object|null;
  function buildPublicAccountBackup(state:object,options?:{now?:number}):object;
  function restorePublicAccountBackup(input:object|string):{session:object;profile:object;relays:object[];blossomServers:object[];follows:object[];publications:object[];rejectedPublications:object[];signerConnected:false};
  function summarizePublicationReceipts(receipts?:object[]|object):{total:number;accepted:number;retrieved:number;verified:boolean;receipts:object[]};
  function extractEventAssets(event:SignedEvent):string[];
  function classifyEventStorage(kind:number):'regular'|'replaceable'|'ephemeral'|'addressable';
  function kindSpec(kind:number):{kind:number;label:string;nip:string;storageClass:string;requiresDTag:boolean};
  function assessRelayOutbox(relay?:object):{status:string;role:string;reasons:string[];verified:boolean};
  function planVerifiedOutbox(relays:object[],options?:{max?:number}):{write:string[];reviewed:object[];insufficientEvidence:boolean};
}
export interface NsiteSDK {
  options:SDKOptions;core:typeof Core;nostr:typeof Nostr;nsite:typeof Nsite;blossom:typeof Blossom;archive:typeof Archive;directory:typeof Directory;storage:typeof Storage;adapters:typeof Adapters;moderation:typeof Moderation;moji:typeof Moji;anchor:typeof Anchor;intelligence:typeof Intelligence;
  publish(files:FileMap,overrides?:SDKOptions & Partial<PublicationOptions>):Promise<{job:object;event:SignedEvent;manifest:ManifestRecord;receipts:PublishReceipts}>;
  query(filter:object,overrides?:object):Promise<SignedEvent[]>;
}
export function createNsiteSDK(options?:SDKOptions):NsiteSDK;
