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
