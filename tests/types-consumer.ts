import {createNsiteSDK,Nsite,Nostr,Archive,Storage,Directory,Blossom,Core,type FileMap,type Signer} from '../types/index.js';
const files:FileMap={'index.html':'hello'};
const sdk=createNsiteSDK({relays:['wss://r.example'],server:'https://blossom.example'});
const template:ReturnType<typeof Nostr.textNote> = Nostr.textNote('hello');
const manifestPromise=Nsite.prepareManifestFiles(files);
const hashPromise=Core.sha256('value');
const zip:Uint8Array=Archive.writeZip(files);
const store=Storage.memoryStore();
const state=Directory.emptyState();
const _publish=sdk.publish(files);
void [template,manifestPromise,hashPromise,zip,store,state,_publish,Blossom];

// Repo-wide Loopy 1.1.0: type contracts exercised by external SDK consumers.
import {Moderation, Moji, Anchor} from '@chaoticka/nsite-loopy-sdk';
const inspected: string = Moderation.inspectNsiteSpam({title:'Safe',description:'Archive'}).status;
const slug: string | null = Moderation.normalizePubkey('a'.repeat(64));
const stats: number = Moji.deriveEmojiStatsFromHash('a'.repeat(64)).hp;
const anchorStorage: 'regular'|'replaceable'|'ephemeral'|'addressable' = Anchor.classifyEventStorage(10000);
const gearBlocks: Uint8Array[] = Archive.gearChunks(new Uint8Array([1,2,3]));
void [inspected, slug, stats, anchorStorage, gearBlocks];

// History APIs keep current revision, exact sightings and per-relay checkpoints separate.
import type {HistorySyncResult,EventObservation} from '../types/index.js';
const historyPromise:Promise<HistorySyncResult>=Nostr.syncEventHistory({relays:['wss://r.example'],filter:{kinds:[30817],'#d':['example']},pageSize:10,boundaryLimit:100});
const sightings:EventObservation[]=[];
const currentHistory=Nostr.collectEventObservations(sightings);
void [historyPromise,currentHistory];

import type {PublicationPlan,PublicationOptions,SignedEvent,EventReplacementReview} from '../types/index.js';
declare const live:SignedEvent;
declare const signer:Signer;
const review:EventReplacementReview=Nostr.prepareEventReplacement(live,{replaceTags:{title:[['title','Updated']]},created_at:live.created_at+1});
const preview:Promise<PublicationPlan>=Nsite.planNsitePublication(files,{pubkey:live.pubkey,server:'https://blossom.example',relays:['wss://r.example'],baseline:live,created_at:live.created_at+1});
const opts:PublicationOptions={pubkey:live.pubkey,server:'https://blossom.example',relays:['wss://r.example'],signer,resolveCurrent:async()=>live,baseline:live,approvedPlan:'a'.repeat(64)};
void [review,preview,opts];

import type {ManifestResolution,VerifiedSiteFile} from '../types/index.js';
const resolved:Promise<ManifestResolution>=Nsite.resolveNsiteManifest(live.pubkey,{identifier:'demo',bootstrap:['wss://r.example'],storage:store,mode:'refresh'});
const loaded:Promise<VerifiedSiteFile|null>=Nsite.loadNsiteFile(live,'/',{store:Archive.contentStore(store),servers:['https://blossom.example']});
void [resolved,loaded];

import type {RevisionRecord, SnapshotRecord, MarkdownSourceComparison} from '../types/index.js';
declare const snapshotEvent:SignedEvent;
const unsignedSnapshot=Archive.snapshotTemplate(live,{created_at:live.created_at+1});
const wrapped:SnapshotRecord=Archive.unwrapSnapshot(snapshotEvent);
const revisionStore=Archive.contentStore(store);
const archived:Promise<RevisionRecord>=Archive.archiveRevision(wrapped.event,revisionStore);
const recovered:Promise<SignedEvent>=archived.then(record=>Archive.restoreRevision(record,revisionStore));
const comparison:MarkdownSourceComparison=Archive.compareMarkdown('old','new');
void [unsignedSnapshot,recovered,comparison];

// Extracted typed, host-independent Anchor advisory APIs.
import { Intelligence } from '../types/index.js';
const advisoryPrefs = Intelligence.reconstructPreferences({events:[],profile:null,relays:[],blossomServers:[]});
const advisoryDraft = Intelligence.detectAndPrepareContent({submission:{assets:[],text:'fixture',explicitHint:'post'},preferences:advisoryPrefs,corrections:[],existingSites:[]});
const advisoryKind: number = advisoryDraft.kind;
void advisoryKind;

// Open Specs registry consumer contract
import { Intelligence as SpecsIntelligence } from "../types/index.js";
const specLookup = SpecsIntelligence.lookupKindDefinitions(31337, []);
void specLookup.proposals;
void SpecsIntelligence.queryOpenSpecs({covers:[31337],outbox:false});

const decodedAuthor: string | null | undefined = Moderation.decodeNip19('nevent1fixture').author;
void decodedAuthor;

import type {RelayDeliveryPlan,RelayDeliverySummary} from '../types/index.js';
function typecheckDelivery(event:SignedEvent):RelayDeliverySummary {
  const plan:RelayDeliveryPlan=Nostr.planRelayDelivery(event,{defaults:['wss://relay.example'],redundancy:2});
  return Nostr.summarizeRelayDelivery(plan,[]);
}
void typecheckDelivery;

// Reconciled Blossom publication prerequisites and verified storage replicas.
const blobMetadata={sha256:'a'.repeat(64),size:12,type:'text/html'};
const blobOptions={servers:['https://blossom.example']};
void Blossom.preflightBlob(blobMetadata,blobOptions).then(result=>result.decisions[0]?.verified);
const batchAuth=Blossom.blossomBatchUploadAuth({hashes:[blobMetadata.sha256],...blobOptions});
void batchAuth.tags;
void Blossom.verifyBlobCopies(blobMetadata,{...blobOptions,required:2}).then(result=>result.copies[0]?.verified);

// Opt-in v2 publication keeps the same entry point and exposes a typed resume checkpoint.
import type {ResumablePublicationJob} from '../types/index.js';
async function typecheckResumable(job:ResumablePublicationJob){
  const settings={...opts,storageServers:[opts.server,'https://replica.example'],requiredCopies:2,gateway:'nsite.lol'};
  const plan=await Nsite.planNsitePublication(files,settings);
  const r=await Nsite.publishNsite(files,{...settings,approvedPlan:plan.id,resume:job});
  const checkpoint:ResumablePublicationJob=r.job;
  return checkpoint.gateway?.status;
}
void typecheckResumable;

// Explicitly approved relay execution and caller-owned transport evidence.
function typecheckExecution(event:SignedEvent, signer:Signer) {
  return Nostr.executeRelayDelivery(event,{allowedRelays:['wss://relay.example'],defaults:['wss://relay.example'],authSigner:signer,authPubkey:event.pubkey}).then(r=>Nostr.planRelayDelivery(event,{observations:r.observations,authPubkey:event.pubkey}));
}
void typecheckExecution;

// Batch 3 subpath declaration & lifecycle contracts.
import { sha256 as coreSha256, classifyEventStorage as coreClassify } from '../types/core.js';
import { scopedStore } from '../types/storage.js';
import { compileEmojiPolicy } from '../types/moderation.js';
const _subpathHash: Promise<string> = coreSha256('subpath');
const _subpathClass: 'regular'|'replaceable'|'ephemeral'|'addressable' = coreClassify(35128);
const _scoped = scopedStore(store, 'ns');
const _compiledPolicy = compileEmojiPolicy({ pubkeys: [live.pubkey] });
const _closed: Promise<void> = sdk.close();
void [_subpathHash, _subpathClass, _scoped, _compiledPolicy, _closed];

// Batch 4 & 5 modular stateless brick contracts.
import { mapLimit, fromBase64Url, decode } from '../types/core.js';
import { createRelayPool, subscribeRelay, createEventStore, deletionTemplate, verifyNip05, planRelayListUpdate, noteEncode, nprofileEncode, neventEncode, naddrEncode } from '../types/nostr.js';
import { fsStore } from '../types/storage.js';
import { findUnreferencedBlobs, repairBlobReplicas } from '../types/blossom.js';
const _mapped: Promise<number[]> = mapLimit([1, 2, 3], 2, x => x * 2);
const _decodedUtf8: string = decode(fromBase64Url('aGVsbG8'));
const _pool = createRelayPool();
const _sub = subscribeRelay('wss://relay.example', { kinds: [1] }, { onEvent: () => {} });
const _eventStore = createEventStore(fsStore('/tmp/nsite-test-store'));
const _delTmpl = deletionTemplate({ ids: ['a'.repeat(64)] });
const _nip05 = verifyNip05('alice@example.com', { expectedPubkey: 'a'.repeat(64) });
const _relayPlan = planRelayListUpdate(null, { add: ['wss://relay.example'] });
const _encodedEntities: string[] = [
  noteEncode('a'.repeat(64)),
  nprofileEncode({ pubkey: 'a'.repeat(64), relays: ['wss://relay.example'] }),
  neventEncode({ id: 'a'.repeat(64), author: 'b'.repeat(64), kind: 1 }),
  naddrEncode({ identifier: 'site', pubkey: 'a'.repeat(64), kind: 35128 }),
];
const _orphans: string[] = findUnreferencedBlobs(['a'.repeat(64)], [{ files: [{ hash: 'b'.repeat(64) }] }]);
const _repaired = repairBlobReplicas({ files: [{ path: '/index.html', hash: 'a'.repeat(64) }] }, { targetServers: ['https://a.example', 'https://b.example'], signer, pubkey: live.pubkey });
const _restoredPrefs: Record<string, unknown> = Anchor.restorePublicAccountBackup({ schema: 'anchor-public-backup/1', pubkey: live.pubkey }).preferences;
void [_mapped, _decodedUtf8, _pool, _sub, _eventStore, _delTmpl, _nip05, _relayPlan, _encodedEntities, _orphans, _repaired, _restoredPrefs];

// Batch 6 modular stateless bricks & consumer testing subpath contracts.
import { createAccountSession, migrateSchema } from '../types/core.js';
import { createRelayHealthCache, rumorTemplate, sealTemplate, giftWrapEvent, unwrapGiftWrap, createBunkerSessionDescriptor, restoreBunkerSigner } from '../types/nostr.js';
import { checkPortablePaths } from '../types/nsite.js';
import { writeZipAsync } from '../types/archive.js';
import { createTestSigner, createMockRelay, createMockBlossom, withStrictBrowserFetch } from '../types/testing.js';
const _session = createAccountSession({ pubkey: live.pubkey, storage: store });
const _migrated = migrateSchema({ schema: 'v/1' }, { targetSchema: 'v/2', migrations: { 'v/1': d => ({ ...d, schema: 'v/2' }) } });
const _healthCache = createRelayHealthCache(store);
const _rumor = rumorTemplate({ pubkey: live.pubkey, content: 'hi' });
const _portable = checkPortablePaths(['index.html']);
const _asyncZip: Promise<Uint8Array> = writeZipAsync(files, { compress: true });
const _bunkerDesc = createBunkerSessionDescriptor({ remotePubkey: live.pubkey, clientPubkey: live.pubkey, relays: ['wss://relay.example'] });
const _restoredBunker = restoreBunkerSigner(_bunkerDesc, { loadClientSecret: async () => new Uint8Array(32) });
const _testSigner = createTestSigner();
const _mockRelay = createMockRelay();
const _mockBlossom = createMockBlossom();
const _strictFetch = withStrictBrowserFetch(_mockBlossom.fetcher);
const _verifiedUpload = Blossom.uploadVerified('hi', { server: 'https://blossom.example', signer, pubkey: live.pubkey, verifyContentType: true });
void [_session, _migrated, _healthCache, _rumor, sealTemplate, giftWrapEvent, unwrapGiftWrap, _portable, _asyncZip, _bunkerDesc, _restoredBunker, _testSigner, _mockRelay, _mockBlossom, _strictFetch, _verifiedUpload];

// Round 2 Big Jobs 1-6 strict types, shared media helpers, pooled SDK, and revision resolver.
import { mediaType as coreMediaType, baseMediaType, contentTypeMatches } from '../types/core.js';
import { createRelayRevisionResolver } from '../types/nsite.js';
import type { DirectoryState, EventStore, RelayPool } from '../types/index.js';
const _mime: string = coreMediaType('/site/index.html');
const _baseMime: string = baseMediaType('text/html; charset=utf-8');
const _mimeMatch: boolean = contentTypeMatches('text/html', 'text/html; charset=utf-8');
const _typedPool: RelayPool = _pool;
const _typedStore: EventStore = _eventStore;
const _typedDirState: DirectoryState = state;
const _pooledSdk = createNsiteSDK({ relays: ['wss://r.example'], pool: _typedPool });
const _pooledClose: Promise<void> = _pooledSdk.close({ closePool: false });
const _resolver = createRelayRevisionResolver({ pool: _typedPool, relays: ['wss://r.example'] });
const _resolvedEvent: Promise<SignedEvent | null> = _resolver({ pubkey: live.pubkey, identifier: 'demo' });
void [_mime, _baseMime, _mimeMatch, _typedPool, _typedStore, _typedDirState, _pooledSdk, _pooledClose, _resolvedEvent];



