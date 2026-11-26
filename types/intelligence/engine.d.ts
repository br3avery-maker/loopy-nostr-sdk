/**
 * Portable Nostr Intelligence Engine
 * Pure, deterministic rules + structured NIP knowledge + explicit correction learning.
 * Completely independent of React, browser APIs, and any specific Nostr SDK.
 */
import type { AccountProfileLike, BlossomEndpoint, ContentSubmission, CoverageAuditReport, ExistingNsiteSummary, InputAsset, LearnedCorrection, NsiteIdentityAnalysis, ObservedActivityRecord, ObservedActivitySummary, PreparedPublicationDraft, PublicationCoverageInput, RawEventLike, ReconstructedPreferences, RelayPreference } from './types.js';
/**
 * Step 1: Reconstruct preferences from recovered events, profile, NIP-65 relays, and Blossom list.
 * Clearly distinguishes recovered, inferred, and unknown preferences.
 */
export declare function reconstructPreferences(params: {
    events: RawEventLike[];
    profile: AccountProfileLike | null;
    relays: RelayPreference[];
    blossomServers: BlossomEndpoint[];
}): ReconstructedPreferences;
/**
 * Analyze nsite identity and enforce root-vs-named safety during the nsite spec transition.
 * Prevents accidentally overwriting an account's root nsite when updating a named site.
 */
export declare function analyzeNsiteIdentity(params: {
    existingSites: ExistingNsiteSummary[];
    assets: InputAsset[];
    requestedMode?: 'root' | 'named';
    requestedSlug?: string;
}): NsiteIdentityAnalysis;
/**
 * Universal `+` Intelligent Preparation Pipeline:
 * Detect content -> recover preferences -> apply learned corrections -> prepare minimal tags -> validate.
 */
export declare function detectAndPrepareContent(params: {
    submission: ContentSubmission;
    preferences: ReconstructedPreferences;
    corrections: LearnedCorrection[];
    existingSites: ExistingNsiteSummary[];
}): PreparedPublicationDraft;
/**
 * Audit relay replication and Blossom media coverage across active publications.
 */
export declare function auditCoverage(publications: PublicationCoverageInput[], nowSec?: number): CoverageAuditReport;
/**
 * Record an explicit user correction for future intelligent drafts.
 */
export declare function recordCorrection(existing: LearnedCorrection[], next: Omit<LearnedCorrection, 'id' | 'recordedAt'>, nowSec?: number): LearnedCorrection[];
/**
 * Summarize observed activity with explicit queried-relay provenance.
 */
export declare function summarizeObservedActivity(records: ObservedActivityRecord[], queriedRelays: string[]): ObservedActivitySummary;
