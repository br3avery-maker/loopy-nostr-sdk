import type {SignedEvent,Hex,RetrievalTransport} from '../index.js';
export declare const OPEN_SPEC_KIND:30817;
export declare const OPEN_SPEC_READ_RELAYS:readonly string[];
export type SpecAuthority='unreviewed-proposal'|'locally-reviewed-proposal';
export interface OpenSpec {event:SignedEvent;coordinate:string;identifier:string;title:string;titleIsDerived:boolean;summary:string;summaryIsDerived:boolean;kinds:{raw:string;kind:number|null;name:string|null}[];topics:string[];status:string|null;publishedAt:number;withdrawn:boolean;references:{type:'coordinate'|'external';value:string;relay:string|null;marker:string|null}[];authority:SpecAuthority;}
export interface OpenSpecIndex {schema:'loopy.open-specs-index/1';records:OpenSpec[];current:OpenSpec[];rejected:{index:number;error:string}[];}
export declare function parseOpenSpec(event:SignedEvent,options?:{maxBytes?:number}):OpenSpec;
export declare function indexOpenSpecs(events:SignedEvent[],options?:{maxBytes?:number}):OpenSpecIndex;
export declare function lookupKindDefinitions(kind:number,events:SignedEvent[],options?:{reviewedEventIds?:Hex[]}):{kind:number;protocolStorageClass:string;builtin:Record<string,unknown>;proposals:OpenSpec[];reviewRequired:boolean;rejected:OpenSpecIndex['rejected']};
export interface OpenSpecQuery extends RetrievalTransport {authors?:Hex[];identifiers?:string[];covers?:number[];topics?:string[];relays?:readonly string[];limit?:number;maxCoordinates?:number;outbox?:boolean;}
export declare function queryOpenSpecs(options?:OpenSpecQuery):Promise<{status:'cancelled'|'unreachable'|'unconfirmed'|'partial'|'observed'|'not-observed';specs:(OpenSpec&{revisionStatus:'unreachable'|'unconfirmed'|'partial'|'observed'})[];index:OpenSpecIndex;observations:{relay:string;event:SignedEvent;stage:string}[];queries:{stage:string;relay:string;received:number;capped:boolean}[];resolution:{coordinate:string;status:string;queries:number}[];errors:{stage:string;relay?:string;error:string}[];rejected:{stage:string;relay:string;error:string}[];complete:false}>;
