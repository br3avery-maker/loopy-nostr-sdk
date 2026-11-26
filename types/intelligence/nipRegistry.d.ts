/**
 * Portable Nostr Intelligence Engine — Structured NIP & Ecosystem Registry
 * Encodes canonical kind semantics, storage classes, client compatibility expectations,
 * and category-specific discovery relays.
 * Zero dependency on React, DOM, or any Nostr SDK.
 */
export type StorageClass = 'regular' | 'replaceable' | 'ephemeral' | 'addressable';
export interface NipKindSpec {
    kind: number;
    label: string;
    nip: string;
    storageClass: StorageClass;
    requiresDTag: boolean;
    summary: string;
}
export interface EcosystemClientSpec {
    id: string;
    name: string;
    category: 'music' | 'article' | 'photo' | 'nsite' | 'social';
    supportedKinds: number[];
    requiredTags: string[];
    recommendedTags: string[];
    discoveryRelays: string[];
    notes: string;
}
export declare const NIP_KIND_REGISTRY: Record<number, NipKindSpec>;
export declare const ECOSYSTEM_DISCOVERY_RELAYS: {
    readonly generalOutbox: readonly ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
    readonly music: readonly ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://relay.wavlake.com"];
    readonly articles: readonly ["wss://nostr-01.yakihonne.com", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
    readonly photos: readonly ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
    readonly nsites: readonly ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://purplepag.es"];
};
export declare const ECOSYSTEM_CLIENTS: EcosystemClientSpec[];
export declare function classifyEventStorage(kind: number): StorageClass;
export declare function getKindSpec(kind: number): NipKindSpec;
export declare const LICENSE_OPTIONS: readonly ["CC BY-SA 4.0", "CC BY 4.0", "CC0 1.0 Public Domain", "All Rights Reserved", "MIT"];
export interface LicenseGuideEntry {
    value: (typeof LICENSE_OPTIONS)[number];
    shortLabel: string;
    plainDescription: string;
    categories: Array<'music' | 'photo' | 'article' | 'nsite' | 'file'>;
}
export declare const LICENSE_GUIDE: LicenseGuideEntry[];
export declare function getLicensesForCategory(category: 'music' | 'photo' | 'article' | 'nsite' | 'file' | 'post'): LicenseGuideEntry[];
export declare const MUSIC_GENRE_SUGGESTIONS: readonly ["nostrmusic", "music", "electronic", "synth", "ambient", "indie", "hiphop", "rock", "lofi", "experimental", "v4v"];
