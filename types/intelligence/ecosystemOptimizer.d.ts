/**
 * Portable Nostr Intelligence Engine — Ecosystem Architecture & Optimization Brain
 *
 * Pure, deterministic, host-agnostic TypeScript module (zero React, DOM, LLM, or Nostr SDK imports).
 * Audits messy, under-formatted, or poorly routed Nostr accounts and outputs:
 *  - Where the creator fits in the Nostr client ecosystem
 *  - How to format each release (Music Kind 36787/31337, Articles 30023, Photos 20, Nsites 15128/35128)
 *  - What exact tags & hashtags to attach for discoverability and V4V zaps
 *  - Where to broadcast (outbox NIP-65 hygiene + category discovery relays)
 *  - Ready-to-load composer prefills so users can fix or upgrade releases in one click
 */
import type { AccountProfileLike, BlossomEndpoint, EcosystemOptimizationReport, EcosystemPublicationInput, PublicationOptimizationAudit, RelayPreference } from './types.js';
/**
 * Audit a single publication against Nostr ecosystem client specs.
 */
export declare function auditSinglePublication(params: {
    pub: EcosystemPublicationInput;
    profile: AccountProfileLike;
    healthyWriteRelays: string[];
    preferredLicense?: string;
}): PublicationOptimizationAudit;
/**
 * Full Account Ecosystem Architecture & Optimization Brain.
 * Evaluates where the user fits, what is holding back visibility, and produces concrete
 * format + tag + broadcast upgrades across Music, Articles, Photos, Nsites, and Outbox infrastructure.
 */
export declare function analyzeAccountEcosystem(params: {
    profile: AccountProfileLike;
    relays: RelayPreference[];
    blossomServers: BlossomEndpoint[];
    publications: EcosystemPublicationInput[];
    preferredLicense?: string;
}): EcosystemOptimizationReport;
