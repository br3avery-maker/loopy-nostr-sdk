/**
 * Account preference reconstruction and nsite root-vs-named identity analysis.
 */
import { canonicalUrl, slugify } from './helpers.js';

/**
 * Step 1: Reconstruct preferences from recovered events, profile, NIP-65 relays, and Blossom list.
 * Clearly distinguishes recovered, inferred, and unknown preferences.
 */
export function reconstructPreferences(params = {}) {
  const safeParams = params && typeof params === 'object' ? params : {};
  const events = Array.isArray(safeParams.events) ? safeParams.events.filter((e) => e && typeof e === 'object') : [];
  const profile = safeParams.profile && typeof safeParams.profile === 'object' ? safeParams.profile : null;
  const relays = Array.isArray(safeParams.relays) ? safeParams.relays.filter((r) => r && typeof r === 'object') : [];
  const blossomServers = Array.isArray(safeParams.blossomServers)
    ? safeParams.blossomServers.filter((b) => b && typeof b === 'object')
    : [];

  // Author / artist name
  const profileName = profile?.display_name || profile?.name || null;
  const artistFromEvents = events
    .flatMap((e) => (Array.isArray(e.tags) ? e.tags : []))
    .find((t) => Array.isArray(t) && t[0] === 'artist' && t[1])?.[1];
  const artistOrAuthorName = profileName
    ? {
        value: profileName,
        provenance: 'recovered',
        sourceNote: 'Recovered from Kind 0 profile metadata',
      }
    : artistFromEvents
      ? {
          value: artistFromEvents,
          provenance: 'inferred',
          sourceNote: 'Inferred from previous release artist tags',
        }
      : {
          value: null,
          provenance: 'unknown',
          sourceNote: 'No profile display name found on queried relays',
        };

  // License preference
  const licenseCounts = new Map();
  for (const ev of events) {
    const tags = Array.isArray(ev.tags) ? ev.tags : [];
    const lic = tags.find((t) => Array.isArray(t) && t[0] === 'license' && t[1])?.[1];
    if (lic) licenseCounts.set(lic, (licenseCounts.get(lic) || 0) + 1);
  }
  const topLicense = Array.from(licenseCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  const preferredLicense = topLicense
    ? {
        value: topLicense[0],
        provenance: 'inferred',
        sourceNote: `Inferred from ${topLicense[1]} prior release${topLicense[1] > 1 ? 's' : ''}`,
      }
    : {
        value: null,
        provenance: 'unknown',
        sourceNote: 'No license tag found in recovered history',
      };

  // Default write relays (exclude explicitly unreachable relays and canonicalize)
  const writeRelays = [
    ...new Set(
      relays
        .filter((r) => r.write && r.wsReachable !== false && r.status !== 'unreachable')
        .map((r) => canonicalUrl(r.url, 'relay'))
        .filter(Boolean)
    ),
  ];
  const defaultWriteRelays =
    writeRelays.length > 0
      ? {
          value: writeRelays,
          provenance: 'recovered',
          sourceNote: `Recovered ${writeRelays.length} write relay${writeRelays.length > 1 ? 's' : ''} from Kind 10002 (NIP-65)`,
        }
      : {
          value: null,
          provenance: 'unknown',
          sourceNote: 'No NIP-65 write relays advertised',
        };

  // Default Blossom servers (exclude explicitly unhealthy/unreachable servers and canonicalize)
  const blossomUrls = [
    ...new Set(
      blossomServers
        .filter((b) => b.healthy !== false && b.status !== 'unreachable' && b.status !== 'unhealthy')
        .map((b) => canonicalUrl(b.url, 'blossom'))
        .filter(Boolean)
    ),
  ];
  const defaultBlossomServers =
    blossomUrls.length > 0
      ? {
          value: blossomUrls,
          provenance: 'recovered',
          sourceNote: `Recovered ${blossomUrls.length} Blossom server${blossomUrls.length > 1 ? 's' : ''} from Kind 10063`,
        }
      : {
          value: null,
          provenance: 'unknown',
          sourceNote: 'No Blossom server list (Kind 10063) found',
        };

  // Common hashtags (strip leading '#' per NIP-12/NIP-24)
  const tagCounts = new Map();
  for (const ev of events) {
    const tags = Array.isArray(ev.tags) ? ev.tags : [];
    for (const tag of tags) {
      if (Array.isArray(tag) && tag[0] === 't' && typeof tag[1] === 'string' && tag[1]) {
        const norm = tag[1].trim().replace(/^#+/, '').toLowerCase();
        if (norm) tagCounts.set(norm, (tagCounts.get(norm) || 0) + 1);
      }
    }
  }
  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t]) => t);
  const defaultHashtags =
    topTags.length > 0
      ? {
          value: topTags,
          provenance: 'inferred',
          sourceNote: `Inferred from recurring #t tags across ${events.length} events`,
        }
      : {
          value: [],
          provenance: 'unknown',
          sourceNote: 'No recurring topics observed yet',
        };

  // Nsite format convention
  const hasNamed = events.some((e) => e.kind === 35128);
  const hasModernRoot = events.some((e) => e.kind === 15128);
  const hasLegacyRoot = events.some((e) => e.kind === 34128);
  const nsiteStrategy = hasNamed
    ? {
        value: 'named-site',
        provenance: 'recovered',
        sourceNote: 'Detected existing named nsite manifest (Kind 35128)',
      }
    : hasModernRoot
      ? {
          value: 'modern-manifest',
          provenance: 'recovered',
          sourceNote: 'Detected modern root nsite manifest (Kind 15128)',
        }
      : hasLegacyRoot
        ? {
            value: 'legacy-root',
            provenance: 'inferred',
            sourceNote: 'Detected legacy Kind 34128 root site; migration guardrail enabled',
          }
        : {
            value: null,
            provenance: 'unknown',
            sourceNote: 'No existing nsite manifests observed',
          };

  const backupCadence = {
    value: null,
    provenance: 'unknown',
    sourceNote: 'Local device setting; not stored on public Nostr relays',
  };

  return {
    artistOrAuthorName,
    preferredLicense,
    defaultWriteRelays,
    defaultBlossomServers,
    defaultHashtags,
    nsiteStrategy,
    backupCadence,
  };
}

/**
 * Analyze nsite identity and enforce root-vs-named safety during the nsite spec transition.
 * Prevents accidentally overwriting an account's root nsite when updating a named site.
 */
export function analyzeNsiteIdentity(params = {}) {
  const safeParams = params && typeof params === 'object' ? params : {};
  const existingSites = Array.isArray(safeParams.existingSites) ? safeParams.existingSites : [];
  const assets = Array.isArray(safeParams.assets) ? safeParams.assets : [];
  const requestedMode = safeParams.requestedMode;
  const requestedSlug = safeParams.requestedSlug;
  const warnings = [];
  const rootSite = existingSites.find((s) => s?.mode === 'root');
  const legacyRoot = existingSites.find((s) => s?.format === 'legacy-34128');
  const namedSites = existingSites.filter((s) => s?.mode === 'named');
  const normalizedSlug = requestedSlug ? slugify(requestedSlug) : undefined;
  const matchingNamedSite = normalizedSlug
    ? namedSites.find((s) => s.dTag === normalizedSlug) ?? namedSites.find((s) => slugify(s.title) === normalizedSlug)
    : undefined;
  const hasIndexHtml = assets.some((a) => /(^|\/)index\.html?$/i.test(a?.path || a?.name || ''));
  if (!hasIndexHtml) {
    warnings.push('No index.html detected at bundle root; gateways may not resolve a default entry page.');
  }
  let detectedMode;
  if (requestedMode) {
    detectedMode = requestedMode;
  } else if (matchingNamedSite || normalizedSlug) {
    detectedMode = 'named';
  } else if (rootSite && namedSites.length > 0) {
    detectedMode = 'named';
    warnings.push(
      'An existing root nsite was detected on this account. Defaulting to a named nsite (Kind 35128) to avoid overwriting your root site.'
    );
  } else if (rootSite) {
    detectedMode = 'named';
    warnings.push(
      'This account already has a root nsite. Choose explicit root update only if you intend to replace the primary site.'
    );
  } else {
    detectedMode = 'root';
  }
  const legacyTransitionDetected = Boolean(legacyRoot);
  if (legacyTransitionDetected) {
    warnings.push(
      'Legacy per-path nsite events (Kind 34128) detected. Publishing a modern manifest (Kind 15128 / 35128) preserves compatibility without deleting legacy paths until verified.'
    );
  }
  const rootOverwriteRisk =
    detectedMode === 'root' &&
    Boolean(rootSite) &&
    (Boolean(normalizedSlug) || rootSite?.format === 'legacy-34128' || true);
  if (detectedMode === 'root' && rootSite) {
    warnings.push(
      `Publishing as root (Kind 15128) will replace your existing root nsite "${rootSite.title}" (${rootSite.fileCount} files). Confirm this is intentional.`
    );
  }
  const recommendedKind = detectedMode === 'named' ? 35128 : 15128;
  const recommendedDTag =
    detectedMode === 'named' ? matchingNamedSite?.dTag || normalizedSlug || 'site-update' : undefined;
  const existingTarget = detectedMode === 'named' ? matchingNamedSite : rootSite;
  const preservesIdentity =
    detectedMode === 'named'
      ? Boolean(matchingNamedSite && matchingNamedSite.dTag === recommendedDTag)
      : Boolean(rootSite);
  const guidance =
    detectedMode === 'named'
      ? matchingNamedSite
        ? `Updating named nsite "${matchingNamedSite.title}" under preserved d-tag "${matchingNamedSite.dTag}" (Kind 35128). Account root nsite remains untouched.`
        : `Creating new named nsite under d-tag "${recommendedDTag}" (Kind 35128). Account root nsite remains untouched.`
      : rootSite
        ? `Explicit root nsite update (Kind 15128) replacing "${rootSite.title}".`
        : 'Publishing initial account root nsite manifest (Kind 15128).';
  return {
    detectedMode,
    recommendedKind,
    recommendedDTag,
    preservesIdentity,
    rootOverwriteRisk,
    legacyTransitionDetected,
    existingTarget,
    warnings,
    guidance,
  };
}
