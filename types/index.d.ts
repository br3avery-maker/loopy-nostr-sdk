/** Nsite Loopy SDK public typed facade (JS runtime; declarations independently typechecked). */
import * as Intelligence from './intelligence/index.js';
export { Intelligence };
export type Hex = string;
export type Endpoint = string;
export interface UnsignedEvent {kind:number;created_at:number;content:string;tags:string[][]}
export interface SignedEvent extends UnsignedEvent {id:Hex;pubkey:Hex;sig:Hex}
export interface Signer {getPublicKey():Promise<Hex>;signEvent(e:UnsignedEvent):Promise<SignedEvent>;close?():Promise<void>;nip44?:{encrypt(peer:Hex,plaintext:string):Promise<string>;decrypt(peer:Hex,ciphertext:string):Promise<string>}}
export interface RelayReceipt {relay:string;eventId:Hex;accepted:true;readback:true;authenticated?:boolean}
export interface PublishReceipts {status?:string;verified:RelayReceipt[];failed?:Array<{relay:string;error:string;code?:string}>}
export interface FileEntry {path:string;hash:Hex;size:number;bytes:Uint8Array}
export interface PreparedFiles {entries:FileEntry[];aggregate:Hex;totalBytes:number;skippedEmpty?:string[]}
export interface PathPortabilityIssue {code:'windows-reserved'|'windows-illegal-char'|'trailing-dot-or-space'|'case-collision'|'unicode-normalization-collision';path?:string;paths?:string[];segment?:string;message:string}
export interface ManifestRecord {pubkey:Hex;kind:number;created_at:number;identifier:string;aggregate:Hex;files:Array<{path:string;hash:Hex}>;url:string;eventId:Hex;verified:boolean}
export interface StorageAdapter {get(key:string):Promise<unknown>;set(key:string,value:unknown):Promise<void>;delete(key:string):Promise<void>;keys(prefix?:string):Promise<string[]>;close?():Promise<void>}
export type FileMap=Record<string,string|Uint8Array|ArrayBuffer>;
export interface RelayListEntry {url:string;read:boolean;write:boolean}
export interface SDKOptions {relays?:string[];server?:string;signer?:Signer;storage?:StorageAdapter;Socket?:any;fetcher?:typeof fetch;clock?:()=>number}
export interface EventReplacementReview {baselineId:Hex;template:UnsignedEvent;contentChanged:boolean;removedTags:string[][];addedTags:string[][];removedProfileFields:string[]}
export interface PublicationPlanOptions {pubkey:Hex;server:Endpoint;storageServers?:Endpoint[];requiredCopies?:number;gateway?:string;relays:Endpoint[];identifier?:string;title?:string;description?:string;created_at?:number;baseline?:SignedEvent|null;approvedPlan?:Hex;clock?:()=>number;emptyFiles?:'reject'|'skip';strictPortablePaths?:boolean}
export interface PublicationPlan {schema:'nsite-publication-plan/1'|'nsite-publication-plan/2';storage?:{servers:Endpoint[];required:number};gateway?:string|null;mimeConflicts?:Array<{hash:Hex;types:string[];paths:string[]}>;skippedEmpty?:string[];portabilityIssues?:PathPortabilityIssue[];id:Hex;pubkey:Hex;identifier:string;server:Endpoint;relays:Endpoint[];baselineId:Hex|null;baselineStatus:'observed'|'unknown';aggregate:Hex;totalBytes:number;files:Array<{path:string;hash:Hex;size:number;type?:string}>;template:UnsignedEvent;changes:Array<{path:string;change:'added'|'modified'|'deleted';from?:Hex;to?:Hex}>;removedTags:string[][];addedTags:string[][]}
export interface GatewayVerification {url:string;status:'verified'|'unverified';files:Array<{path:string;status:'hash-verified'|'unverified'}>}
export interface ResumablePublicationJob {schema:'nsite-job/2';identifier:string;aggregate:Hex;planId:Hex;baselineId:Hex|null;files:Array<{path:string;hash:Hex;size:number;type:string;copies:BlobReadbackCopy[];attempts:Array<{server:Endpoint;status:string;code?:string}>}>;relays:RelayReceipt[];stage:'prepared'|'uploading'|'signed'|'relay-verified'|'site-verified'|'gateway-unverified';event:SignedEvent|null;eventId:Hex|null;gateway:GatewayVerification|null;url?:string}
export interface PublicationProgressEvent {stage:'prepared'|'uploading'|'signed'|'relay-verified'|'gateway';path?:string;hash?:Hex;server?:Endpoint;deduplicated?:boolean;completed:number;total:number}
export interface PublicationOptions extends PublicationPlanOptions {signer:Signer;resume?:ResumablePublicationJob;allowFileRemovals?:boolean;resolveCurrent?:(request:{pubkey:Hex;kind:number;identifier:string;relays:Endpoint[];signal?:AbortSignal})=>Promise<SignedEvent|null>;uploader?:(data:Uint8Array,options:object)=>Promise<{hash:Hex;verified:boolean}>;publisher?:(event:SignedEvent,relays:string[],options?:object)=>Promise<PublishReceipts>;checkpoint?:(job:object)=>Promise<void>|void;signal?:AbortSignal;Socket?:any;fetcher?:typeof fetch;timeoutMs?:number;authSigner?:Signer;authPubkey?:Hex;requireAuthentication?:boolean;preflight?:boolean;batchAuth?:boolean;gatewayTimeoutMs?:number;gatewayConcurrency?:number;onProgress?:(event:PublicationProgressEvent)=>void}
export interface BoundedFetchOptions {fetcher?:typeof fetch;timeoutMs?:number;maxBytes?:number;signal?:AbortSignal;read?:'none'|'bytes'|'text'|'json';acceptRedirects?:boolean}
export interface BoundedFetchResult {ok:boolean;status:number;headers?:Headers;data?:Uint8Array;text?:string;json?:unknown}
export interface RuntimeCapabilities {subtleCrypto:boolean;webSocket:boolean;fetch:boolean;indexedDB:boolean;decompressionStream:boolean;secureContext:boolean;browserNip07:boolean}
export interface SdkErrorDetails {code?:string;stage?:string;retryable?:boolean;status?:number;relay?:string;server?:string;cause?:unknown}
export namespace Core {
  function encode(value:string):Uint8Array;
  function decode(value:string|Uint8Array|ArrayBuffer):string;
  function bytes(value:string|Uint8Array|ArrayBuffer):Uint8Array;
  function hex(value:Uint8Array):string;
  function unhex(value:string):Uint8Array;
  function sha256(value:string|Uint8Array|ArrayBuffer,options?:object):Promise<Hex>;
  function toBase64(value:string|Uint8Array|ArrayBuffer):string;
  function toBase64Url(value:string|Uint8Array|ArrayBuffer):string;
  function fromBase64Url(value:string):Uint8Array;
  function isPrivateOrLocalHost(hostname:string):boolean;
  function endpoint(input:string,type?:'relay'|'blossom',options?:{publicHost?:boolean}):string;
  function endpoints(values:string[],type?:'relay'|'blossom',max?:number,options?:{publicHost?:boolean}):string[];
  function nsitePath(input:string):string;
  function slug(value:string):string;
  function isHex(value:unknown,length?:number):value is Hex;
  function assertHex(value:unknown,length?:number,label?:string):Hex;
  function hasLoneSurrogate(text:string):boolean;
  function assertSafeInt(value:unknown,options?:{min?:number;max?:number;label?:string}):number;
  function isForbiddenKey(key:unknown):boolean;
  function safeHttpUrl(input:unknown,options?:{allowHttp?:boolean;maxLength?:number}):string|null;
  function assertSafeHttpUrl(input:unknown,options?:{allowHttp?:boolean;maxLength?:number}):string;
  function canonicalGatewayHost(input:string):string;
  function classifyEventStorage(kind:number):'regular'|'replaceable'|'ephemeral'|'addressable';
  function checkRuntimeCapabilities(env?:Record<string,unknown>):RuntimeCapabilities;
  function defaultFetch(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]):ReturnType<typeof fetch>;
  function sdkError(message:string,details?:SdkErrorDetails):Error & SdkErrorDetails;
  function boundedFetch(url:string,init?:RequestInit,options?:BoundedFetchOptions):Promise<BoundedFetchResult>;
  function normalizeOptions(options?:SDKOptions):SDKOptions;
  function mapLimit<T,R>(items:Iterable<T>,concurrency:number,worker:(item:T,index:number)=>Promise<R>|R,options?:{signal?:AbortSignal}):Promise<R[]>;
  function createAccountSession(options?:{pubkey?:Hex;storage?:StorageAdapter;onInvalidate?:(info:{pubkey:Hex|null;reason:string|null})=>Promise<void>|void}):AccountSession;
  function migrateSchema<T extends {schema:string}=Record<string,unknown>&{schema:string}>(input:{schema:string}&Record<string,unknown>,options:{targetSchema:string;migrations?:Record<string,(doc:any)=>any>;validate?:(doc:T)=>void;maxSteps?:number}):SchemaMigrationResult<T>;
}
export interface AccountSession {pubkey:Hex|null;signal:AbortSignal;storage:StorageAdapter|null;readonly aborted:boolean;readonly closed:boolean;readonly reason:string|null;assertActive():void;register(cleanup:()=>Promise<void>|void):()=>void;invalidate(reason?:string):Promise<void>;close():Promise<void>}
export interface SchemaMigrationResult<T=Record<string,unknown>&{schema:string}> {schema:string;from:string;to:string;migrated:boolean;steps:Array<{from:string;to:string}>;data:T}
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
  monitorEvents?:SignedEvent[]; observations?:RelayTransportObservation[]; monitorTTL?:number; observationTTL?:number;
  now?:number; policyTTL?:number; redundancy?:number; maxCandidates?:number; visibility?:'public'|'private'; authPubkey?:Hex; authAvailable?:boolean;
}
export interface RelayDeliveryCandidate {relay:Endpoint;requiresAuthentication:boolean;policyObservedAt:number|null;warnings:string[];evidence:{monitorHints:Array<{eventId:Hex;source:Hex;accepted:boolean}>;priorReadback:boolean}}
export interface RelayDeliveryPlan {
  eventId:Hex;kind:number;storageClass:string;frameBytes:number;visibility:'public'|'private';protectedEvent:boolean;at:number;
  groups:Array<{id:string;required:number;selected:RelayDeliveryCandidate[];fallbacks:RelayDeliveryCandidate[];omitted:number;status:'recipient-list-missing'|'insufficient-candidates'|'planned-unverified'}>;
  excluded:Array<{group:string;relay:Endpoint;reasons:string[]}>;
}
export interface RelayTransportObservation {relay:Endpoint;eventId:Hex;author:Hex;kind:number;principal:Hex|'anonymous';at:number;code:string;accepted:boolean;readback:boolean}
export interface RelayPublishOptions {Socket?:any;timeoutMs?:number;signal?:AbortSignal;verify?:boolean;authSigner?:Signer;authPubkey?:Hex;requireAuthentication?:boolean;acceptEphemeral?:boolean}
export interface RelayDeliveryExecutionOptions extends Omit<RelayDeliveryOptions,'authAvailable'|'allowedRelays'> {allowedRelays:Endpoint[];authSigner?:Signer;signal?:AbortSignal;Socket?:any;timeoutMs?:number;maxAttempts?:number;clock?:()=>number}
export interface RelayDeliveryReceipt {relay:Endpoint;eventId:Hex;accepted:boolean;readback?:boolean;authenticated?:boolean}
export interface RelayDeliverySummary {eventId:Hex;status:'verified'|'accepted-ephemeral'|'partial-or-failed';groups:Array<{id:string;required:number;accepted:Endpoint[];delivered:Endpoint[];status:'verified'|'accepted-ephemeral'|'accepted-incomplete'|'not-delivered'}>}
export namespace Nostr {
  function planRelayDelivery(event:SignedEvent,options?:RelayDeliveryOptions):RelayDeliveryPlan;
  function summarizeRelayDelivery(plan:RelayDeliveryPlan,receipts?:RelayDeliveryReceipt[]):RelayDeliverySummary;
  function executeRelayDelivery(event:SignedEvent,options:RelayDeliveryExecutionOptions):Promise<{plan:RelayDeliveryPlan;receipts:RelayDeliveryReceipt[];attempts:Array<{relay:Endpoint;status:'accepted'|'accepted-unverified'|'failed';code?:string}>;observations:RelayTransportObservation[];summary:RelayDeliverySummary}>;

  function reviewEventReplacement(baseline:SignedEvent,template:UnsignedEvent,pubkey:Hex):EventReplacementReview;
  function prepareEventReplacement(baseline:SignedEvent,options?:{pubkey?:Hex;content?:string;replaceTags?:Record<string,string[][]>;created_at?:number}):EventReplacementReview;
  function eventIdentity(event:SignedEvent):string;
  function collectEventObservations(observations:EventObservation[]):{records:EventHistoryRecord[];current:SignedEvent[];rejected:Array<{index:number;error:string}>};
  function syncEventHistory(options:HistorySyncOptions):Promise<HistorySyncResult>;
  function relayAuthTemplate(options:{challenge:string;relay:string;created_at?:number}):UnsignedEvent;
  function httpAuthHeader(options:{url:string;method:string;signer:Signer;pubkey:Hex;payload?:string|Uint8Array|ArrayBuffer;created_at?:number}):Promise<string>;
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
  function bunkerSigner(uri:string,options?:{clientSecret?:Uint8Array;allowNip05Lookup?:boolean;timeoutMs?:number}):Promise<Signer&{connect():Promise<Hex>;ping():Promise<string>;close():Promise<void>}>;
  function nostrConnectRequest(options:{relays:string[];name?:string;perms?:string[];secret?:string;clientSecret?:Uint8Array}):{uri:string;mode:'nip46';start(signal?:AbortSignal):Promise<Signer&{ping():Promise<string>;close():Promise<void>}>};
  function connectIdentity(signer:Signer):Promise<{pubkey:Hex;signer:Signer}>;
  function createBunkerSessionDescriptor(options:{remotePubkey:Hex;userPubkey?:Hex;relays:string[];clientPubkey:Hex;permissions?:string[];createdAt?:number}):BunkerSessionDescriptor;
  function restoreBunkerSigner(descriptor:BunkerSessionDescriptor,options:{loadClientSecret:(clientPubkey:Hex)=>Promise<Uint8Array>|Uint8Array;connectOptions?:object;createTransport?:(ctx:{clientSecret:Uint8Array;pointer:{pubkey:Hex;relays:Endpoint[];secret:null};descriptor:BunkerSessionDescriptor;connectOptions:object})=>any}):Promise<Signer&{connect():Promise<Hex>;ping():Promise<string>;close():Promise<void>}>;
  function androidIntent(input:{type?:'get_public_key'|'sign_event';requestId:string;event?:UnsignedEvent;currentPubkey?:Hex;callbackUrl?:string}):string;
  function verifyAndroidResult(input:{requestId:string;returnedId:string;event:SignedEvent;template:UnsignedEvent;expectedPubkey:Hex;rejected?:boolean}):SignedEvent;
  function relayList(event:SignedEvent):RelayListEntry[];
  function planRelays(options:{authorList?:RelayListEntry[];recipientLists?:RelayListEntry[][];defaults?:string[];max?:number}):string[];
  function relayInfo(url:string,options?:{fetcher?:typeof fetch;signal?:AbortSignal;timeoutMs?:number;maxBytes?:number}):Promise<Record<string,unknown>>;
  function discoverRelays(pubkey:Hex,options?:RetrievalTransport&{bootstrap?:string[];defaults?:string[];max?:number;now?:number}):Promise<{status:string;records:RelayListEntry[];relays:string[];sourceEvent:string|null;errors:Array<{relay:string;error:string}>}>;
  function blossomServers(event:SignedEvent):string[];
  function discoverBlossom(pubkey:Hex,options?:RetrievalTransport&{bootstrap?:string[];now?:number}):Promise<{sourceEvent:string|null;servers:string[];verified:boolean;errors:Array<{relay:string;error:string}>}>;
  function queryRelay(url:string,filter:object,options?:{Socket?:any;timeoutMs?:number;signal?:AbortSignal;verify?:boolean;maxEvents?:number;maxFrames?:number;maxBytes?:number;authSigner?:Signer;authPubkey?:Hex}):Promise<SignedEvent[]>;
  function publishRelay(url:string,event:SignedEvent,options?:RelayPublishOptions & {acceptEphemeral?:false}):Promise<RelayReceipt>;
  function publishRelay(url:string,event:SignedEvent,options:RelayPublishOptions):Promise<RelayDeliveryReceipt>;
  function publishMany(event:SignedEvent,relays:string[],options?:RelayPublishOptions & {writer?:(url:string,event:SignedEvent,options:object)=>Promise<RelayDeliveryReceipt>}):Promise<PublishReceipts>;
  function textNote(content:string,options?:{replyTo?:SignedEvent;created_at?:number}):UnsignedEvent;
  function reaction(target:SignedEvent,emoji?:string,options?:{created_at?:number}):UnsignedEvent;
  function publishTemplate(template:UnsignedEvent,options:{signer:Signer;pubkey:Hex;relays:string[];publisher?:(event:SignedEvent,relays:string[],options?:object)=>Promise<PublishReceipts>;signal?:AbortSignal;timeoutMs?:number;Socket?:any;authSigner?:Signer;authPubkey?:Hex}):Promise<{event:SignedEvent;receipts:PublishReceipts}>;
  function fetchFeed(options:{authors:Hex[];kinds?:number[];relays:string[];limit?:number;query?:(url:string,filter:object,options?:object)=>Promise<SignedEvent[]>;signal?:AbortSignal;timeoutMs?:number;Socket?:any}):Promise<{events:SignedEvent[];failed:Array<{relay:string;error:string}>;status:string}>;
  function parseProfile(event:SignedEvent):Record<string,string|number>;
  function fetchProfiles(options:{pubkeys:Hex[];relays:string[];query?:(url:string,filter:object,options?:object)=>Promise<SignedEvent[]>;signal?:AbortSignal;timeoutMs?:number;Socket?:any}):Promise<{profiles:Map<Hex,Record<string,string|number>>;failed:object[];status:string}>;
  function planRelayListUpdate(currentEvent?:SignedEvent|null,options?:{add?:Array<string|{url:string;read?:boolean;write?:boolean}>;remove?:string[];setMode?:Record<string,'read'|'write'|'both'|{read:boolean;write:boolean}>;created_at?:number}):{template:UnsignedEvent;records:RelayListEntry[];broadcastRelays:Endpoint[];added:Endpoint[];removed:Endpoint[]};
  function subscribeRelay(url:string,filter:object,options?:{onEvent?:(event:SignedEvent,meta:{relay:Endpoint;live:boolean})=>void;onEose?:(meta:{relay:Endpoint})=>void;onClosed?:(meta:{relay:Endpoint;reason:string})=>void;onError?:(err:Error)=>void;Socket?:any;signal?:AbortSignal;verify?:boolean;maxEvents?:number;maxFrames?:number;maxBytes?:number;authSigner?:Signer;authPubkey?:Hex}):{close():void};
  function createRelayPool(options?:{Socket?:any;timeoutMs?:number;authSigner?:Signer;authPubkey?:Hex;maxFrames?:number;maxBytes?:number}):{query(relays:string[],filter:object,options?:{timeoutMs?:number;signal?:AbortSignal;verify?:boolean;maxEvents?:number;authSigner?:Signer;authPubkey?:Hex}):Promise<{events:SignedEvent[];relays:Endpoint[];failed:Array<{relay:Endpoint;code:string;error:string}>}>;subscribe(relays:string[],filter:object,options?:{onEvent?:(event:SignedEvent,meta:{relay:Endpoint;live:boolean})=>void;onEose?:(meta:{relay:Endpoint;allEosed:boolean})=>void;onClosed?:(meta:{relay:Endpoint;reason:string})=>void;onError?:(err:Error)=>void;signal?:AbortSignal;verify?:boolean;maxEvents?:number;authSigner?:Signer;authPubkey?:Hex}):{close():void};publish(relays:string[],event:SignedEvent,options?:RelayPublishOptions):Promise<PublishReceipts>;relays():Endpoint[];close():void};
  function deletionTemplate(options?:{ids?:Hex[];addresses?:string[];reason?:string;created_at?:number}):UnsignedEvent;
  function createEventStore(storage:StorageAdapter):{put(event:SignedEvent,options?:{verify?:boolean}):Promise<{stored:boolean;id:Hex;reason?:string;replacedId?:Hex|null;winnerId?:Hex}>;get(id:Hex):Promise<SignedEvent|null>;query(filter?:object):Promise<SignedEvent[]>;applyDeletion(deletionEvent:SignedEvent,options?:{verify?:boolean;retainArchive?:boolean}):Promise<{deletionId:Hex;deletedIds:Hex[];deletedAddresses:string[];ignored:Array<{type:'e'|'a';target:string;reason:string}>}>;keys():Promise<Hex[]>;count():Promise<number>;close():Promise<void>};
  function verifyNip05(identifier:string,options?:{expectedPubkey?:Hex;fetcher?:typeof fetch;timeoutMs?:number;maxBytes?:number;signal?:AbortSignal}):Promise<{identifier:string;name:string;domain:string;url:string;pubkey:Hex|null;relays:Endpoint[];matched:boolean;verified:boolean;reason:string|null}>;
  function decodeNip19(value:string):{type:string;hex:Hex;author?:Hex|null;relays?:string[];identifier?:string|null;kind?:number|null};
  function noteEncode(eventId:Hex):string;
  function nprofileEncode(input:{pubkey:Hex;relays?:string[]}):string;
  function neventEncode(input:{id:Hex;relays?:string[];author?:Hex;kind?:number}):string;
  function naddrEncode(input:{identifier?:string;pubkey:Hex;kind:number;relays?:string[]}):string;
  function createRelayHealthCache(storage:StorageAdapter,options?:{prefix?:string;observationTtl?:number;policyTtl?:number;monitorTtl?:number;maxObservations?:number;maxPolicies?:number;maxMonitorEvents?:number}):RelayHealthCache;
  function rumorTemplate(options:{pubkey:Hex;kind?:number;content?:string;tags?:string[][];created_at?:number}):Promise<RumorEvent>;
  function sealTemplate(rumor:RumorEvent,options:{recipientPubkey:Hex;encryptor:{encrypt(peer:Hex,plaintext:string):Promise<string>};created_at?:number;jitterSeconds?:number}):Promise<UnsignedEvent>;
  function giftWrapEvent(sealEvent:SignedEvent,options:{recipientPubkey:Hex;encryptorForEphemeral:(secretKey:Uint8Array)=>Promise<{encrypt(peer:Hex,plaintext:string):Promise<string>}>|{encrypt(peer:Hex,plaintext:string):Promise<string>};created_at?:number;jitterSeconds?:number;ephemeralSecretKey?:Uint8Array}):Promise<{event:SignedEvent;ephemeralPubkey:Hex}>;
  function unwrapGiftWrap(wrapEvent:SignedEvent,options:{recipientPubkey?:Hex;decryptor:{decrypt(peer:Hex,ciphertext:string):Promise<string>}}):Promise<{wrap:SignedEvent;seal:SignedEvent;rumor:RumorEvent}>;
}
export interface BunkerSessionDescriptor {schema:'nip46-bunker-session/1';remotePubkey:Hex;userPubkey?:Hex;clientPubkey:Hex;relays:Endpoint[];permissions:string[];createdAt:number}
export interface RumorEvent extends UnsignedEvent {id:Hex;pubkey:Hex}
export interface RelayHealthCache {recordObservations(observations:RelayTransportObservation[],options?:{now?:number}):Promise<{added:number;stored:number}>;getObservations(options?:{now?:number;relay?:string;principal?:string}):Promise<RelayTransportObservation[]>;savePolicy(relay:string,document:Record<string,unknown>,options?:{observedAt?:number;now?:number}):Promise<{relay:Endpoint;observedAt:number;document:Record<string,unknown>}>;getPolicies(options?:{now?:number;relay?:string}):Promise<Array<{relay:Endpoint;observedAt:number;document:Record<string,unknown>}>>;saveMonitorEvent(event:SignedEvent,options?:{now?:number}):Promise<{relay:Endpoint;event:SignedEvent;stored:number}>;getMonitorEvents(options?:{now?:number;relay?:string}):Promise<SignedEvent[]>;exportForDelivery(options?:{now?:number}):Promise<{observations:RelayTransportObservation[];relayPolicies:Array<{relay:Endpoint;observedAt:number;document:Record<string,unknown>}>;monitorEvents:SignedEvent[]}>;clear():Promise<void>}
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
  function prepareManifestFiles(files:FileMap,options?:{maxFiles?:number;maxBytes?:number;emptyFiles?:'reject'|'skip'}):Promise<PreparedFiles>;
  function manifestTemplate(prepared:PreparedFiles,options?:{identifier?:string;server?:string;title?:string;description?:string;created_at?:number}):UnsignedEvent;
  function parseManifest(event:SignedEvent,options?:{verify?:boolean;now?:number}):Promise<ManifestRecord>;
  function compareFiles(before:FileMap,after:FileMap):Promise<object[]>;
  function mediaType(path:string):string;
  function normalizeFileMap(input:FileMap):Record<string,Uint8Array>;
  function checkPortablePaths(input:string[]|FileMap):{ok:boolean;checked:number;issues:PathPortabilityIssue[]};
  function publishNsite(files:FileMap,options:PublicationOptions & ({storageServers:Endpoint[]}|{requiredCopies:number}|{gateway:string})):Promise<{job:ResumablePublicationJob;event:SignedEvent;manifest:ManifestRecord;receipts:PublishReceipts}>;
  function publishNsite(files:FileMap,options:PublicationOptions):Promise<{job:object;event:SignedEvent;manifest:ManifestRecord;receipts:PublishReceipts}>;
}
export interface BlobMetadata {sha256:Hex;size:number;type:string}
export interface BlobPreflightDecision {server:string;status:number|null;code:string;verified:false}
export interface BlobReadbackCopy {server:string;hash:Hex;size:number;type:string;verified:true}
export interface BlobNetworkOptions {servers:string[];fetcher?:typeof fetch;signal?:AbortSignal;timeoutMs?:number}
export namespace Blossom {
  function preflightBlob(blob:BlobMetadata,options:BlobNetworkOptions):Promise<BlobMetadata & {decisions:BlobPreflightDecision[];selected:string[];fallbacks:string[]}>;
  function blossomBatchUploadAuth(options:{hashes:Hex[];servers:string[];now?:number;expiresIn?:number}):UnsignedEvent;
  function verifyBlobCopies(blob:BlobMetadata,options:BlobNetworkOptions & {required?:number;maxBytes?:number;earlyStop?:boolean;concurrency?:number}):Promise<BlobMetadata & {required:number;copies:BlobReadbackCopy[];failed:Array<{server:string;code:string}>;status:'verified'|'partial'|'unverified'}>;
  function blossomAuthHeader(event:SignedEvent):string;
  function blossomUploadAuth(options:{hash:Hex;server:string;expiresIn?:number;now?:number}):UnsignedEvent;
  function uploadVerified(data:string|Uint8Array|ArrayBuffer,options:{server:string;signer?:Signer;pubkey?:Hex;authEvent?:SignedEvent;path?:string;fetcher?:typeof fetch;signal?:AbortSignal;clock?:()=>number;timeoutMs?:number;expectedType?:string;verifyContentType?:boolean}):Promise<{hash:Hex;size:number;server:string;verified:true;url:string;typeVerified?:true;type?:string}>;
  function fetchVerified(hash:Hex,options:{servers:string[];fetcher?:typeof fetch;signal?:AbortSignal;timeoutMs?:number;maxBytes?:number}):Promise<{server:string;data:Uint8Array;hash:Hex;failed:Array<{error:string}>}>;
  function findUnreferencedBlobs(storedHashes:Iterable<Hex>,retainedManifests?:Iterable<object>):Hex[];
  function repairBlobReplicas(manifest:object,options:{sourceServers?:string[];targetServers:string[];signer:Signer;pubkey:Hex;requiredCopies?:number;fetcher?:typeof fetch;uploader?:(data:Uint8Array,options:object)=>Promise<{hash:Hex;verified:boolean}>;signal?:AbortSignal;clock?:()=>number;timeoutMs?:number;preflight?:boolean;onProgress?:(event:{hash:Hex;path:string;status:string;completed:number;total:number})=>void}):Promise<{status:'healthy'|'partial'|'degraded';requiredCopies:number;totalBlobs:number;healthy:number;repaired:number;degraded:number;blobs:Array<{hash:Hex;path:string;size:number|null;type:string;status:'healthy'|'repaired'|'degraded';beforeCopies:Endpoint[];afterCopies:Endpoint[];uploadedTo:Endpoint[];failed:object[]}>}>;
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
  function restoreChunkManifest(manifest:{profile:string;size:number;hash:Hex;chunks:Array<{hash:Hex;size:number}>},read:(hash:Hex)=>Promise<Uint8Array>,options?:{maxBytes?:number;maxChunks?:number;hash?:(data:Uint8Array)=>Promise<Hex>}):Promise<Uint8Array>;
  function readZip(data:Uint8Array,options?:{maxFiles?:number;maxOutputBytes?:number;maxRatio?:number;inflate?:(data:Uint8Array)=>Promise<Uint8Array>}):Promise<Record<string,Uint8Array>>;
  function writeZip(files:FileMap,options?:{maxFiles?:number;maxBytes?:number}):Uint8Array;
  function writeZipAsync(files:FileMap,options?:{maxFiles?:number;maxBytes?:number;compress?:boolean;deflate?:(data:Uint8Array)=>Promise<Uint8Array>|Uint8Array}):Promise<Uint8Array>;
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
  function scopedStore(adapter:StorageAdapter,namespace:string):StorageAdapter;
  function fsStore(directory:string):StorageAdapter;
}
export namespace Adapters {
  function browserEnvironment(options?:object):{signer:Signer|null;storage:StorageAdapter|null;Socket:any;fetcher:typeof fetch};
  function androidHandoff(options:{launch:(uri:string)=>Promise<void>;onReturn:(requestId:string)=>Promise<{id:string;event?:SignedEvent;result?:string;rejected?:boolean}>}):{sign(options:{requestId:string;event:UnsignedEvent;expectedPubkey:Hex;callbackUrl?:string}):Promise<SignedEvent>;getPublicKey(options:{requestId:string;callbackUrl?:string}):Promise<Hex>};
}
export namespace Moderation {
  const CAMPAIGN_ROLE_OPENERS:readonly string[];
  const MOJI_CURATOR_BLOCKLIST_VERSION:string;
  const BUILT_IN_NSFW_BAN_PUBKEYS:readonly Hex[];
  const BUILT_IN_NSFW_MEDIA_URLS:readonly string[];
  const BUILT_IN_NSFW_BLOB_HASHES:readonly Hex[];
  function decodeNip19(value:string):{type:string;hex:Hex;author?:Hex|null;relays?:string[];identifier?:string|null;kind?:number|null};
  function noteEncode(eventId:Hex):string;
  function nprofileEncode(input:{pubkey:Hex;relays?:string[]}):string;
  function neventEncode(input:{id:Hex;relays?:string[];author?:Hex;kind?:number}):string;
  function naddrEncode(input:{identifier?:string;pubkey:Hex;kind:number;relays?:string[]}):string;
  function normalizePubkey(value:string|null|undefined):Hex|null;
  function normalizeEmojiHash(value:string|null|undefined):Hex|null;
  function normalizePubkeyList(values:readonly string[]):Hex[];
  function normalizeHashList(values:readonly string[]):Hex[];
  function parseCuratorBlocklist(raw:string):{schema:string;pubkeys:Hex[];emojiHashes:Hex[];mediaUrls:string[]};
  function parseNip51MuteList(event:SignedEvent):{pubkey:Hex;pubkeys:Hex[];eventId:Hex;createdAt:number};
  function muteListTemplate(pubkeys:readonly string[],options?:{created_at?:number}):UnsignedEvent;
  function mergeBlocklists(...lists:object[]):{pubkeys:Hex[];emojiHashes:Hex[];mediaUrls:string[]};
  function compileEmojiPolicy(policy?:object):Readonly<{__compiledEmojiPolicy:true;blockedEmojiKeys:Set<string>;bannedPubkeys:Set<Hex>;bannedEmojiHashes:Set<Hex>;safePubkeys:Set<Hex>;filterMode:string;isSignedIn:boolean;activeUserPubkey:Hex|null}>;
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
  function restorePublicAccountBackup(input:object|string):{session:object;profile:object;relays:object[];blossomServers:object[];follows:object[];publications:object[];rejectedPublications:object[];preferences:Record<string,unknown>;signerConnected:false};
  function summarizePublicationReceipts(receipts?:object[]|object):{total:number;accepted:number;retrieved:number;verified:boolean;receipts:object[]};
  function extractEventAssets(event:SignedEvent):string[];
  function classifyEventStorage(kind:number):'regular'|'replaceable'|'ephemeral'|'addressable';
  function kindSpec(kind:number):{kind:number;label:string;nip:string;storageClass:string;requiresDTag:boolean};
  function assessRelayOutbox(relay?:object):{status:string;role:string;reasons:string[];verified:boolean};
  function planVerifiedOutbox(relays:object[],options?:{max?:number}):{write:string[];reviewed:object[];insufficientEvidence:boolean};
}
export namespace Testing {
  function createTestSigner(options?:{secretKey?:Uint8Array;includeNip44?:boolean}):Signer & {mode:'test';pubkey:Hex;secretKey:Uint8Array;signedEvents:SignedEvent[];close():Promise<void>};
  function createMockRelay(options?:{url?:string;requireAuth?:boolean;challenge?:string;initialEvents?:SignedEvent[];onEvent?:(event:SignedEvent,socket:any)=>{accepted:boolean;message?:string}|void;onReq?:(subId:string,filters:object[],socket:any)=>void}):{url:Endpoint;Socket:any;events:Map<Hex,SignedEvent>;sentFrames:Array<{url:string;frame:unknown[]}>;connections:any[];pushEvent(event:SignedEvent):SignedEvent;reset():void};
  function createMockBlossom(options?:{servers?:string[];preflightStatus?:number;requireAuth?:boolean}):{servers:Endpoint[];store:Map<string,{bytes:Uint8Array;type:string;size:number}>;requests:Array<{method:string;url:string;headers:Record<string,unknown>}>;seed(server:string,data:string|Uint8Array|ArrayBuffer,contentType?:string):Promise<{hash:Hex;size:number;url:string;type:string}>;fetcher:typeof fetch;clear():void};
  function withStrictBrowserFetch(fetcher:typeof fetch):typeof fetch;
}
export interface NsiteSDK {
  options:SDKOptions;core:typeof Core;nostr:typeof Nostr;nsite:typeof Nsite;blossom:typeof Blossom;archive:typeof Archive;directory:typeof Directory;storage:typeof Storage;adapters:typeof Adapters;moderation:typeof Moderation;moji:typeof Moji;anchor:typeof Anchor;intelligence:typeof Intelligence;
  publish(files:FileMap,overrides?:SDKOptions & Partial<PublicationOptions>):Promise<{job:object;event:SignedEvent;manifest:ManifestRecord;receipts:PublishReceipts}>;
  query(filter:object,overrides?:{relay?:Endpoint;relays?:Endpoint[];Socket?:any;timeoutMs?:number;signal?:AbortSignal;verify?:boolean;maxEvents?:number;maxFrames?:number;maxBytes?:number;authSigner?:Signer;authPubkey?:Hex}):Promise<SignedEvent[]>;
  close():Promise<void>;
}
export function createNsiteSDK(options?:SDKOptions):NsiteSDK;
