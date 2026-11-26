/**
 * Portable Nostr Intelligence Engine — Host-Agnostic Types
 * Zero dependency on React, DOM, or any specific Nostr SDK.
 */

export type ContentCategory = 'music' | 'photo' | 'article' | 'post' | 'nsite' | 'file';

export type ProvenanceState = 'recovered' | 'inferred' | 'unknown' | 'user-set';

export interface ProvenanceField<T> {
  value: T | null;
  provenance: ProvenanceState;
  sourceNote: string;
}

export interface RawEventLike {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: string;
}

export interface RelayPreference {
  url: string;
  read: boolean;
  write: boolean;
  status?: 'connected' | 'degraded' | 'unreachable' | 'unknown';
  latencyMs?: number;
  nip11Name?: string;
  nip11Description?: string;
  nip11Software?: string;
  supportedNips?: number[];
  paymentRequired?: boolean;
  authRequired?: boolean;
  restrictedWrites?: boolean;
  httpStatus?: number;
  wsReachable?: boolean;
  lastError?: string;
  audienceOverlapCount?: number;
}

export interface BlossomEndpoint {
  url: string;
  label?: string;
  healthy?: boolean;
}

export interface AccountProfileLike {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
}

export interface ReconstructedPreferences {
  artistOrAuthorName: ProvenanceField<string>;
  preferredLicense: ProvenanceField<string>;
  defaultWriteRelays: ProvenanceField<string[]>;
  defaultBlossomServers: ProvenanceField<string[]>;
  defaultHashtags: ProvenanceField<string[]>;
  nsiteStrategy: ProvenanceField<'modern-manifest' | 'legacy-root' | 'named-site'>;
  backupCadence: ProvenanceField<'weekly' | 'after-publish' | 'manual'>;
}

export interface LearnedCorrection {
  id: string;
  contentType: ContentCategory | 'all';
  field: 'license' | 'artist' | 'hashtags' | 'nsiteMode' | 'blossomServer';
  previousValue: string;
  correctedValue: string;
  recordedAt: number;
}

export interface InputAsset {
  name: string;
  path?: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  textPreview?: string;
  durationSec?: number;
}

export interface ContentSubmission {
  explicitHint?: ContentCategory;
  musicKindPreference?: 36787 | 31337;
  text?: string;
  title?: string;
  summary?: string;
  assets: InputAsset[];
  targetSiteMode?: 'root' | 'named';
  targetSiteSlug?: string;
  existingPublicationId?: string;
  existingDTag?: string;
  /** Optional already-hosted Blossom / HTTPS URLs (for upgrading existing releases without re-uploading) */
  externalAudioUrl?: string;
  externalAudioMime?: string;
  externalAudioSha256?: string;
  externalDurationSec?: number;
  externalCoverUrl?: string;
  externalImageUrl?: string;
  externalAlt?: string;
  publishedAt?: number;
  aiGenerated?: boolean;
  zapPubkey?: string;
  zapRelay?: string;
}

export interface ExistingNsiteSummary {
  id: string;
  title: string;
  mode: 'root' | 'named';
  format: 'modern-15128' | 'legacy-34128' | 'named-35128';
  dTag?: string;
  fileCount: number;
  updatedAt: number;
  manifestHash?: string;
}

export interface NsiteIdentityAnalysis {
  detectedMode: 'root' | 'named';
  recommendedKind: 15128 | 35128;
  recommendedDTag?: string;
  preservesIdentity: boolean;
  rootOverwriteRisk: boolean;
  legacyTransitionDetected: boolean;
  existingTarget?: ExistingNsiteSummary;
  warnings: string[];
  guidance: string;
}

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  field?: string;
}

export interface PreparedPublicationDraft {
  detectedCategory: ContentCategory;
  confidence: 'high' | 'medium';
  rationale: string;
  kind: number;
  kindLabel: string;
  nipRef: string;
  title: string;
  summary: string;
  content: string;
  artist?: string;
  license?: string;
  dTag?: string;
  hashtags: string[];
  tags: string[][];
  assetsToUpload: InputAsset[];
  targetRelays: string[];
  targetBlossomServers: string[];
  appliedPreferences: string[];
  appliedCorrections: string[];
  nsiteAnalysis?: NsiteIdentityAnalysis;
  validationIssues: ValidationIssue[];
  readyToPublish: boolean;
}

export interface PublicationCoverageInput {
  id: string;
  title: string;
  category: ContentCategory;
  kind: number;
  eventId: string;
  publishedRelays: string[];
  expectedRelays: string[];
  assetHashes: string[];
  assetLocations: Record<string, string[]>;
  expectedBlossomServers: string[];
  deleted?: boolean;
}

export interface PublicationCoverageGap {
  publicationId: string;
  title: string;
  category: ContentCategory;
  eventId: string;
  missingRelays: string[];
  missingAssets: Array<{
    sha256: string;
    missingServers: string[];
  }>;
  relayCoverageRatio: number;
  mediaCoverageRatio: number;
  status: 'healthy' | 'degraded' | 'critical';
}

export interface CoverageAuditReport {
  auditedAt: number;
  totalActivePublications: number;
  healthyCount: number;
  degradedCount: number;
  criticalCount: number;
  overallRelayCoveragePct: number;
  overallMediaCoveragePct: number;
  gaps: PublicationCoverageGap[];
}

export interface ObservedActivityRecord {
  id: string;
  type: 'reply' | 'reaction' | 'repost' | 'mention' | 'follower';
  authorPubkey: string;
  authorName?: string;
  targetEventId?: string;
  targetTitle?: string;
  content: string;
  createdAt: number;
  observedOnRelays: string[];
}

export interface ObservedActivitySummary {
  queriedRelays: string[];
  totalObserved: number;
  counts: {
    reply: number;
    reaction: number;
    repost: number;
    mention: number;
    follower: number;
  };
  provenanceStatement: string;
}

/* -------------------------------------------------------------------------- */
/* Ecosystem Architecture & Optimization Brain Types                          */
/* -------------------------------------------------------------------------- */

export type ClientCompatibilityStatus = 'ready' | 'partial' | 'invisible';

export type OptimizationArea =
  | 'music'
  | 'photos'
  | 'articles'
  | 'nsites'
  | 'outbox'
  | 'profile';

export interface OptimizationDraftPrefill {
  label: string;
  rationale: string;
  category: ContentCategory;
  musicKindPreference?: 36787 | 31337;
  title: string;
  summary: string;
  content: string;
  artist?: string;
  license?: string;
  dTag?: string;
  hashtags: string[];
  externalAudioUrl?: string;
  externalAudioMime?: string;
  externalAudioSha256?: string;
  externalDurationSec?: number;
  externalCoverUrl?: string;
  externalImageUrl?: string;
  externalAlt?: string;
  publishedAt?: number;
  recommendedRelays: string[];
  sourcePublicationId?: string;
}

export interface ClientFitEntry {
  clientId: string;
  clientName: string;
  category: 'music' | 'article' | 'photo' | 'nsite' | 'social';
  supportedKinds: number[];
  status: ClientCompatibilityStatus;
  headline: string;
  reason: string;
  missingRequirements: string[];
  recommendedRelays: string[];
}

export interface OptimizationRecommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  area: OptimizationArea;
  title: string;
  diagnosis: string;
  whereYouFit: string;
  howToFormat: string;
  whereToBroadcast: string[];
  tagsToAdd: string[][];
  targetKind?: number;
  sourcePublicationId?: string;
  sourceTitle?: string;
  prefillDraft?: OptimizationDraftPrefill;
}

export interface PublicationOptimizationAudit {
  publicationId: string;
  title: string;
  category: ContentCategory;
  kind: number;
  formatScore: number;
  status: 'optimized' | 'needs-tuning' | 'under-formatted';
  diagnosis: string;
  missingTags: string[];
  suggestedHashtags: string[];
  recommendedRelays: string[];
  clientCompatibility: Array<{
    clientName: string;
    status: ClientCompatibilityStatus;
    reason: string;
  }>;
  prefillDraft?: OptimizationDraftPrefill;
}

export interface EcosystemPublicationInput {
  id: string;
  category: ContentCategory;
  kind: number;
  title: string;
  summary: string;
  content: string;
  artist?: string;
  license?: string;
  dTag?: string;
  hashtags: string[];
  tags: string[][];
  createdAt: number;
  publishedRelays: string[];
  assets: Array<{
    name: string;
    path?: string;
    mimeType: string;
    sha256: string;
    urls: string[];
    storedOnServers: string[];
    role?: string;
    durationSec?: number;
  }>;
  deleted?: boolean;
}

export type RelayRoleClass =
  | 'general-outbox'
  | 'music-specialty'
  | 'article-specialty'
  | 'directory-index'
  | 'dm-chat-only'
  | 'fediverse-bridge'
  | 'paid-or-gated'
  | 'community-niche'
  | 'dead-or-redirect';

export type RelayVerdict =
  | 'keep-outbox'
  | 'keep-read-only'
  | 'specialty-only'
  | 'demote-or-remove'
  | 'recommended-add';

export interface RelayAuditEntry {
  url: string;
  read: boolean;
  write: boolean;
  roleClass: RelayRoleClass;
  roleLabel: string;
  verdict: RelayVerdict;
  verdictLabel: string;
  score: number;
  reason: string;
  status: 'connected' | 'degraded' | 'unreachable' | 'unknown';
  latencyMs?: number;
  nip11Name?: string;
  policyFlags: string[];
  audienceOverlapCount?: number;
}

export interface RelayOptimizationPlan {
  auditedRelays: RelayAuditEntry[];
  discoveredCandidates: RelayAuditEntry[];
  recommendedWriteRelays: string[];
  recommendedReadRelays: string[];
  recommendedMusicRelays: string[];
  recommendedArticleRelays: string[];
  relaysToDropOrDemote: RelayAuditEntry[];
  sampledFollowsCount: number;
  proposedKind10002Tags: string[][];
  summary: string;
}

export interface EcosystemOptimizationReport {
  overallScore: number;
  pillars: {
    formatAndSpecs: number;
    discoverabilityAndTags: number;
    broadcastAndOutbox: number;
    storageAndMedia: number;
  };
  archetype: {
    label: string;
    headline: string;
    explanation: string;
    primaryStrengths: string[];
    biggestVisibilityBlockers: string[];
  };
  clientMatrix: ClientFitEntry[];
  musicSpotlight: {
    hasMusicSignals: boolean;
    detectedTrackCount: number;
    kind36787Count: number;
    kind31337Count: number;
    kindOtherCount: number;
    underFormattedCount: number;
    catalogGaps: Array<{
      field: string;
      missingCount: number;
      totalCount: number;
    }>;
    underFormattedTracks: Array<{
      publicationId: string;
      title: string;
      kind: number;
      formatScore: number;
      missingTags: string[];
      prefillDraft?: OptimizationDraftPrefill;
    }>;
    trappedMusicCount: number;
    trappedMusicSources: Array<{
      publicationId: string;
      title: string;
      kind: number;
      reason: string;
    }>;
    missingSpecFields: string[];
    recommendedRelays: string[];
    recommendedKind: 36787;
    prefillDraft?: OptimizationDraftPrefill;
  };
  outboxDiagnosis: {
    writeRelayCount: number;
    healthyWriteRelayCount: number;
    degradedWriteRelays: string[];
    mismatchedWriteRelays: string[];
    blossomCount: number;
    recommendedWriteRelays: string[];
    summary: string;
  };
  relayPlan: RelayOptimizationPlan;
  recommendations: OptimizationRecommendation[];
  publicationAudits: Record<string, PublicationOptimizationAudit>;
}
