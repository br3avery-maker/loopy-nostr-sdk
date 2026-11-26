/**
 * Relay/media coverage auditing, learned correction recording, and observed activity summaries.
 */
import { canonicalUrl } from './helpers.js';

/**
 * Audit relay replication and Blossom media coverage across active publications.
 */
export function auditCoverage(publications = [], nowSec = Math.floor(Date.now() / 1000)) {
  const safePubs = Array.isArray(publications) ? publications.filter((p) => p && typeof p === 'object') : [];
  const active = safePubs.filter((p) => !p.deleted);
  const gaps = [];
  let healthyCount = 0;
  let degradedCount = 0;
  let criticalCount = 0;
  let relayRatioSum = 0;
  let mediaRatioSum = 0;
  let mediaCheckedCount = 0;
  for (const pub of active) {
    const publishedRelays = Array.isArray(pub.publishedRelays) ? pub.publishedRelays : [];
    const expectedRelays = Array.isArray(pub.expectedRelays) ? pub.expectedRelays : [];
    const assetHashes = Array.isArray(pub.assetHashes) ? pub.assetHashes : [];
    const assetLocations = pub.assetLocations && typeof pub.assetLocations === 'object' ? pub.assetLocations : {};
    const expectedBlossomServers = Array.isArray(pub.expectedBlossomServers) ? pub.expectedBlossomServers : [];

    const publishedSet = new Set(publishedRelays.map((r) => canonicalUrl(r, 'relay')));
    const missingRelays = expectedRelays.filter((r) => !publishedSet.has(canonicalUrl(r, 'relay')));
    const relayCoverageRatio =
      expectedRelays.length > 0 ? (expectedRelays.length - missingRelays.length) / expectedRelays.length : 1;
    relayRatioSum += relayCoverageRatio;

    const missingAssets = [];
    let totalAssetSlots = 0;
    let presentAssetSlots = 0;
    for (const hash of assetHashes) {
      const present = new Set(
        (Array.isArray(assetLocations[hash]) ? assetLocations[hash] : []).map((s) => canonicalUrl(s, 'blossom'))
      );
      const missingServers = expectedBlossomServers.filter((s) => !present.has(canonicalUrl(s, 'blossom')));
      totalAssetSlots += expectedBlossomServers.length;
      presentAssetSlots += expectedBlossomServers.length - missingServers.length;
      if (missingServers.length > 0) {
        missingAssets.push({ sha256: hash, missingServers });
      }
    }
    const mediaCoverageRatio = totalAssetSlots > 0 ? presentAssetSlots / totalAssetSlots : 1;
    if (totalAssetSlots > 0) {
      mediaRatioSum += mediaCoverageRatio;
      mediaCheckedCount += 1;
    }
    let status = 'healthy';
    if (relayCoverageRatio === 0 || (totalAssetSlots > 0 && mediaCoverageRatio === 0)) {
      status = 'critical';
      criticalCount += 1;
    } else if (missingRelays.length > 0 || missingAssets.length > 0) {
      status = 'degraded';
      degradedCount += 1;
    } else {
      healthyCount += 1;
    }
    gaps.push({
      publicationId: pub.id,
      title: pub.title,
      category: pub.category,
      eventId: pub.eventId,
      missingRelays,
      missingAssets,
      relayCoverageRatio,
      mediaCoverageRatio,
      status,
    });
  }
  return {
    auditedAt: nowSec,
    totalActivePublications: active.length,
    healthyCount,
    degradedCount,
    criticalCount,
    overallRelayCoveragePct: active.length > 0 ? Math.round((relayRatioSum / active.length) * 100) : 100,
    overallMediaCoveragePct: mediaCheckedCount > 0 ? Math.round((mediaRatioSum / mediaCheckedCount) * 100) : 100,
    gaps,
  };
}

/**
 * Record an explicit user correction for future intelligent drafts.
 */
export function recordCorrection(existing = [], next = {}, nowSec = Math.floor(Date.now() / 1000)) {
  const safeExisting = Array.isArray(existing) ? existing : [];
  if (!next || typeof next !== 'object') return safeExisting;
  if (next.previousValue === next.correctedValue || typeof next.correctedValue !== 'string' || !next.correctedValue.trim()) {
    return safeExisting;
  }
  const filtered = safeExisting.filter((c) => !(c.contentType === next.contentType && c.field === next.field));
  return [
    ...filtered,
    {
      ...next,
      id: `corr-${next.contentType}-${next.field}-${nowSec}`,
      recordedAt: nowSec,
    },
  ];
}

/**
 * Summarize observed activity with explicit queried-relay provenance.
 */
export function summarizeObservedActivity(records = [], queriedRelays = []) {
  const safeRecords = Array.isArray(records) ? records : [];
  const safeRelays = Array.isArray(queriedRelays) ? queriedRelays : [];
  const counts = {
    reply: 0,
    reaction: 0,
    repost: 0,
    mention: 0,
    follower: 0,
  };
  for (const r of safeRecords) {
    if (r && Object.hasOwn(counts, r.type)) {
      counts[r.type] += 1;
    }
  }
  const relayCount = safeRelays.length;
  const provenanceStatement =
    relayCount > 0
      ? `Observed across ${relayCount} queried relay${relayCount === 1 ? '' : 's'} — counts reflect received events, not global totals.`
      : 'No relays queried yet — connect or refresh relays to observe incoming events.';
  return {
    queriedRelays: safeRelays,
    totalObserved: safeRecords.length,
    counts,
    provenanceStatement,
  };
}
