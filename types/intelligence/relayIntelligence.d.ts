/**
 * Portable Nostr Intelligence Engine — Relay Fitness, Classification & Outbox Planner
 *
 * Pure, deterministic, host-agnostic TypeScript module (zero React, DOM, LLM, or Nostr SDK imports).
 * Never blindly assumes a user's existing relays are healthy or appropriate for public publishing.
 * Classifies relays by protocol role (general outbox, music/article specialty, directory-only,
 * encrypted chat/DM, fediverse bridge, paid/gated, community/niche, or broken/redirecting),
 * evaluates real NIP-11 / WebSocket / audience-overlap evidence, and produces a concrete Kind 10002 plan.
 */
import type { RelayAuditEntry, RelayOptimizationPlan, RelayPreference, RelayRoleClass } from './types.js';
export declare const CANDIDATE_DISCOVERY_RELAYS: ReadonlyArray<{
    url: string;
    roleHint: 'general-outbox' | 'music-specialty' | 'article-specialty' | 'directory-index';
    label: string;
}>;
export declare function isSuitablePublicOutboxRole(role: RelayRoleClass): boolean;
export declare function roleClassLabel(role: RelayRoleClass): string;
/**
 * Deterministically classify a relay's real role, policy constraints, health, and suitability
 * as a public NIP-65 write/outbox relay.
 */
export declare function classifyRelay(relay: RelayPreference, options?: {
    isCandidate?: boolean;
    audienceOverlapCount?: number;
}): RelayAuditEntry;
/**
 * Build a complete, honest Relay Optimization Plan that NEVER assumes the user's current relays are right.
 */
export declare function buildRelayOptimizationPlan(params: {
    currentRelays: RelayPreference[];
    candidateRelays?: RelayPreference[];
    followRelayCounts?: Record<string, number>;
    sampledFollowsCount?: number;
    hasMusic?: boolean;
    hasArticles?: boolean;
}): RelayOptimizationPlan;
