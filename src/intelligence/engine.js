/**
 * Portable Nostr Intelligence Engine
 * Pure, deterministic rules + structured NIP knowledge + explicit correction learning.
 * Completely independent of React, browser APIs, and any specific Nostr SDK.
 */
import { getKindSpec } from './nipRegistry.js';
function slugify(value) {
    const cleaned = value
        .toLowerCase()
        .trim()
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return cleaned || 'untitled-release';
}
function titleFromFilename(filename) {
    const base = filename.split('/').pop() || filename;
    const withoutExt = base.replace(/\.[^/.]+$/, '');
    const withoutTrackNum = withoutExt.replace(/^\d{1,3}[\s._-]+/, '');
    return withoutTrackNum
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
function isAudioAsset(asset) {
    return (asset.mimeType.startsWith('audio/') ||
        /\.(mp3|flac|wav|ogg|m4a|opus)$/i.test(asset.name));
}
function isImageAsset(asset) {
    return (asset.mimeType.startsWith('image/') ||
        /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(asset.name));
}
function isMarkdownAsset(asset) {
    return (asset.mimeType === 'text/markdown' ||
        /\.(md|markdown)$/i.test(asset.name));
}
function isSiteArchiveOrHtml(asset) {
    return (asset.mimeType === 'application/zip' ||
        asset.mimeType === 'text/html' ||
        /\.zip$/i.test(asset.name) ||
        /(^|\/)index\.html?$/i.test(asset.path || asset.name));
}
function extractMarkdownFrontmatter(text) {
    let body = text.trim();
    let title;
    let summary;
    const tags = [];
    if (body.startsWith('---')) {
        const endIdx = body.indexOf('\n---', 3);
        if (endIdx !== -1) {
            const fm = body.slice(3, endIdx).trim();
            body = body.slice(endIdx + 4).trim();
            for (const line of fm.split('\n')) {
                const colon = line.indexOf(':');
                if (colon === -1)
                    continue;
                const key = line.slice(0, colon).trim().toLowerCase();
                const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
                if (key === 'title' && val)
                    title = val;
                if ((key === 'summary' || key === 'description') && val)
                    summary = val;
                if (key === 'tags' && val) {
                    const parsed = val
                        .replace(/^\[|\]$/g, '')
                        .split(',')
                        .map((t) => t.trim().replace(/^#/, '').toLowerCase())
                        .filter(Boolean);
                    tags.push(...parsed);
                }
            }
        }
    }
    if (!title) {
        const h1 = body.match(/^#\s+(.+)$/m);
        if (h1) {
            title = h1[1].trim();
        }
    }
    if (!summary) {
        const paragraphs = body
            .replace(/^#+\s+.+$/gm, '')
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter(Boolean);
        if (paragraphs[0]) {
            summary = paragraphs[0].slice(0, 180);
        }
    }
    return { title, summary, tags, body };
}
function extractInlineHashtags(text) {
    const matches = text.match(/#([a-zA-Z0-9_-]{2,32})/g) || [];
    return Array.from(new Set(matches.map((m) => m.slice(1).toLowerCase())));
}
/**
 * Step 1: Reconstruct preferences from recovered events, profile, NIP-65 relays, and Blossom list.
 * Clearly distinguishes recovered, inferred, and unknown preferences.
 */
export function reconstructPreferences(params) {
    const { events, profile, relays, blossomServers } = params;
    // Author / artist name
    const profileName = profile?.display_name || profile?.name || null;
    const artistFromEvents = events
        .flatMap((e) => e.tags)
        .find((t) => t[0] === 'artist' && t[1])?.[1];
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
        const lic = ev.tags.find((t) => t[0] === 'license' && t[1])?.[1];
        if (lic) {
            licenseCounts.set(lic, (licenseCounts.get(lic) || 0) + 1);
        }
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
    // Default write relays
    const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
    const defaultWriteRelays = writeRelays.length > 0
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
    // Default Blossom servers
    const blossomUrls = blossomServers.map((b) => b.url);
    const defaultBlossomServers = blossomUrls.length > 0
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
    // Common hashtags
    const tagCounts = new Map();
    for (const ev of events) {
        for (const tag of ev.tags) {
            if (tag[0] === 't' && tag[1]) {
                const norm = tag[1].toLowerCase().trim();
                if (norm)
                    tagCounts.set(norm, (tagCounts.get(norm) || 0) + 1);
            }
        }
    }
    const topTags = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([t]) => t);
    const defaultHashtags = topTags.length > 0
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
    // Backup cadence cannot be recovered from public relays — always unknown on first run
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
export function analyzeNsiteIdentity(params) {
    const { existingSites, assets, requestedMode, requestedSlug } = params;
    const warnings = [];
    const rootSite = existingSites.find((s) => s.mode === 'root');
    const legacyRoot = existingSites.find((s) => s.format === 'legacy-34128');
    const namedSites = existingSites.filter((s) => s.mode === 'named');
    const normalizedSlug = requestedSlug ? slugify(requestedSlug) : undefined;
    const matchingNamedSite = normalizedSlug
        ? namedSites.find((s) => s.dTag === normalizedSlug || slugify(s.title) === normalizedSlug)
        : undefined;
    const hasIndexHtml = assets.some((a) => /(^|\/)index\.html?$/i.test(a.path || a.name));
    if (!hasIndexHtml) {
        warnings.push('No index.html detected at bundle root; gateways may not resolve a default entry page.');
    }
    let detectedMode;
    if (requestedMode) {
        detectedMode = requestedMode;
    }
    else if (matchingNamedSite || normalizedSlug) {
        detectedMode = 'named';
    }
    else if (rootSite && namedSites.length > 0) {
        // Safer default when both root and named sites exist: default to named to protect root!
        detectedMode = 'named';
        warnings.push('An existing root nsite was detected on this account. Defaulting to a named nsite (Kind 35128) to avoid overwriting your root site.');
    }
    else if (rootSite) {
        detectedMode = 'named';
        warnings.push('This account already has a root nsite. Choose explicit root update only if you intend to replace the primary site.');
    }
    else {
        detectedMode = 'root';
    }
    const legacyTransitionDetected = Boolean(legacyRoot);
    if (legacyTransitionDetected) {
        warnings.push('Legacy per-path nsite events (Kind 34128) detected. Publishing a modern manifest (Kind 15128 / 35128) preserves compatibility without deleting legacy paths until verified.');
    }
    // Root overwrite risk triggers if user targets 'root' while a root site exists (especially if a slug was also supplied)
    const rootOverwriteRisk = detectedMode === 'root' &&
        Boolean(rootSite) &&
        (Boolean(normalizedSlug) || rootSite?.format === 'legacy-34128' || true);
    if (detectedMode === 'root' && rootSite) {
        warnings.push(`Publishing as root (Kind 15128) will replace your existing root nsite "${rootSite.title}" (${rootSite.fileCount} files). Confirm this is intentional.`);
    }
    const recommendedKind = detectedMode === 'named' ? 35128 : 15128;
    const recommendedDTag = detectedMode === 'named'
        ? matchingNamedSite?.dTag || normalizedSlug || 'site-update'
        : undefined;
    const existingTarget = detectedMode === 'named' ? matchingNamedSite : rootSite;
    const preservesIdentity = detectedMode === 'named'
        ? Boolean(matchingNamedSite && matchingNamedSite.dTag === recommendedDTag)
        : Boolean(rootSite);
    const guidance = detectedMode === 'named'
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
/**
 * Find the most recent learned correction for a field and content category.
 */
function findCorrection(corrections, contentType, field) {
    return [...corrections]
        .sort((a, b) => b.recordedAt - a.recordedAt)
        .find((c) => c.field === field &&
        (c.contentType === contentType || c.contentType === 'all'));
}
/**
 * Universal `+` Intelligent Preparation Pipeline:
 * Detect content -> recover preferences -> apply learned corrections -> prepare minimal tags -> validate.
 */
export function detectAndPrepareContent(params) {
    const { submission, preferences, corrections, existingSites } = params;
    const assets = submission.assets || [];
    const text = (submission.text || '').trim();
    const audioAssets = assets.filter(isAudioAsset);
    const imageAssets = assets.filter(isImageAsset);
    const markdownAssets = assets.filter(isMarkdownAsset);
    const siteAssets = assets.filter(isSiteArchiveOrHtml);
    // 1. Detect content category
    let detectedCategory;
    let confidence = 'high';
    let rationale = '';
    if (submission.explicitHint) {
        detectedCategory = submission.explicitHint;
        rationale = `Prepared as ${submission.explicitHint} based on selected content type.`;
    }
    else if (siteAssets.length > 0 ||
        (assets.length >= 2 && assets.some((a) => /\.(html?|css|js)$/i.test(a.name)))) {
        detectedCategory = 'nsite';
        rationale = 'Detected web entry/bundle files (HTML/ZIP/static assets); preparing nsite manifest.';
    }
    else if (audioAssets.length > 0) {
        detectedCategory = 'music';
        rationale =
            imageAssets.length > 0
                ? `Detected audio track (${audioAssets[0].name}) paired with cover artwork (${imageAssets[0].name}); preparing Kind 31337 music release.`
                : `Detected audio file (${audioAssets[0].name}); preparing Kind 31337 music release.`;
    }
    else if (markdownAssets.length > 0 ||
        text.length > 320 ||
        /^#\s+.+/m.test(text) ||
        text.startsWith('---')) {
        detectedCategory = 'article';
        rationale = 'Detected structured Markdown or long-form prose; preparing NIP-23 addressable article (Kind 30023).';
    }
    else if (imageAssets.length > 0 && assets.length === imageAssets.length) {
        detectedCategory = 'photo';
        rationale = `Detected ${imageAssets.length} image asset${imageAssets.length > 1 ? 's' : ''}; preparing NIP-68 picture publication (Kind 20).`;
    }
    else if (assets.length > 0) {
        detectedCategory = 'file';
        rationale = `Detected general file (${assets[0].name}); preparing NIP-94 file metadata event (Kind 1063).`;
    }
    else {
        detectedCategory = 'post';
        confidence = text.length > 0 ? 'high' : 'medium';
        rationale = 'Detected concise text content; preparing standard NIP-01 short note (Kind 1).';
    }
    // 2. Recover preferences & apply learned corrections
    const appliedPreferences = [];
    const appliedCorrections = [];
    const targetRelays = preferences.defaultWriteRelays.value || [];
    if (targetRelays.length > 0) {
        appliedPreferences.push(`Write relays (${targetRelays.length}) from ${preferences.defaultWriteRelays.provenance}`);
    }
    const blossomCorrection = findCorrection(corrections, detectedCategory, 'blossomServer');
    const targetBlossomServers = blossomCorrection
        ? [blossomCorrection.correctedValue]
        : preferences.defaultBlossomServers.value || [];
    if (blossomCorrection) {
        appliedCorrections.push(`Blossom target overridden to ${blossomCorrection.correctedValue}`);
    }
    else if (targetBlossomServers.length > 0) {
        appliedPreferences.push(`Blossom servers (${targetBlossomServers.length}) from ${preferences.defaultBlossomServers.provenance}`);
    }
    const artistCorrection = findCorrection(corrections, detectedCategory, 'artist');
    const artist = artistCorrection?.correctedValue ||
        preferences.artistOrAuthorName.value ||
        undefined;
    if (artistCorrection) {
        appliedCorrections.push(`Artist attribution set to "${artistCorrection.correctedValue}"`);
    }
    else if (artist) {
        appliedPreferences.push(`Attribution "${artist}" (${preferences.artistOrAuthorName.provenance})`);
    }
    const licenseCorrection = findCorrection(corrections, detectedCategory, 'license');
    const license = licenseCorrection?.correctedValue ||
        preferences.preferredLicense.value ||
        undefined;
    if (licenseCorrection) {
        appliedCorrections.push(`License set to "${licenseCorrection.correctedValue}"`);
    }
    else if (license) {
        appliedPreferences.push(`License "${license}" (${preferences.preferredLicense.provenance})`);
    }
    // 3. Build kind, metadata, and minimal accurate tags
    let kind = 1;
    let title = submission.title?.trim() || '';
    let summary = submission.summary?.trim() || '';
    let content = text;
    let dTag = submission.existingDTag;
    let nsiteAnalysis;
    const hashtags = new Set(extractInlineHashtags(text));
    const validationIssues = [];
    const tags = [];
    if (detectedCategory === 'music') {
        kind = submission.musicKindPreference ?? 31337;
        const primaryAudio = audioAssets[0];
        const coverImage = imageAssets[0];
        if (!title && primaryAudio) {
            title = titleFromFilename(primaryAudio.name);
        }
        dTag = dTag || slugify(title || 'track');
        if (!summary) {
            summary = artist ? `${title || 'Untitled Track'} by ${artist}` : title || 'Audio release';
        }
        if (!content) {
            content = summary;
        }
        tags.push(['d', dTag]);
        if (title)
            tags.push(['title', title]);
        if (artist)
            tags.push(['artist', artist]);
        if (license)
            tags.push(['license', license]);
        if (typeof submission.aiGenerated === 'boolean') {
            tags.push(['ai_generated', submission.aiGenerated ? 'true' : 'false']);
        }
        const blobBase = targetBlossomServers[0]?.replace(/\/$/, '') || 'https://blossom.pending';
        const resolvedAudioUrl = primaryAudio
            ? `${blobBase}/${primaryAudio.sha256 || 'pending-sha256'}`
            : submission.externalAudioUrl?.trim();
        const resolvedAudioMime = primaryAudio?.mimeType || submission.externalAudioMime || 'audio/mpeg';
        const resolvedAudioHash = primaryAudio?.sha256 || submission.externalAudioSha256 || '';
        const resolvedDuration = primaryAudio?.durationSec ?? submission.externalDurationSec;
        if (resolvedAudioUrl) {
            // Direct `url` tag is required by modern Kind 36787 music players (Amethyst, Gruuv, Wisp, Wavlake)
            tags.push(['url', resolvedAudioUrl]);
            tags.push(['format', resolvedAudioMime]);
            const imetaEntries = [`url ${resolvedAudioUrl}`, `m ${resolvedAudioMime}`];
            if (resolvedAudioHash)
                imetaEntries.push(`x ${resolvedAudioHash}`);
            if (primaryAudio?.sizeBytes)
                imetaEntries.push(`size ${primaryAudio.sizeBytes}`);
            tags.push(['imeta', ...imetaEntries]);
            if (resolvedDuration && resolvedDuration > 0) {
                tags.push(['duration', String(Math.round(resolvedDuration))]);
            }
        }
        else {
            validationIssues.push({
                level: 'error',
                code: 'MISSING_AUDIO',
                field: 'assets',
                message: 'Add an audio file (.mp3, .flac, .wav, .ogg) or a direct Blossom audio URL to publish a music release.',
            });
        }
        const resolvedCoverUrl = coverImage
            ? `${blobBase}/${coverImage.sha256 || 'pending-cover-sha256'}`
            : submission.externalCoverUrl?.trim();
        if (resolvedCoverUrl) {
            tags.push(['image', resolvedCoverUrl]);
        }
        else {
            validationIssues.push({
                level: 'info',
                code: 'NO_COVER_ART',
                field: 'assets',
                message: 'No cover artwork attached; music clients display releases better with square cover art.',
            });
        }
        if (submission.zapPubkey) {
            tags.push([
                'zap',
                submission.zapPubkey,
                submission.zapRelay || targetRelays[0] || 'wss://relay.damus.io',
                '1',
            ]);
        }
        hashtags.add('music');
        if (kind === 36787) {
            hashtags.add('nostrmusic');
        }
    }
    else if (detectedCategory === 'article') {
        kind = 30023;
        const rawMd = markdownAssets[0]?.textPreview || text;
        const parsed = extractMarkdownFrontmatter(rawMd);
        title = title || parsed.title || (markdownAssets[0] ? titleFromFilename(markdownAssets[0].name) : '');
        summary = summary || parsed.summary || '';
        content = parsed.body || text;
        for (const t of parsed.tags)
            hashtags.add(t);
        dTag = dTag || slugify(title || 'article');
        tags.push(['d', dTag]);
        if (title)
            tags.push(['title', title]);
        if (summary)
            tags.push(['summary', summary]);
        if (license)
            tags.push(['license', license]);
        tags.push([
            'published_at',
            String(submission.publishedAt || Math.floor(Date.now() / 1000)),
        ]);
        if (imageAssets[0]) {
            const blobBase = targetBlossomServers[0]?.replace(/\/$/, '') || 'https://blossom.pending';
            tags.push(['image', `${blobBase}/${imageAssets[0].sha256 || 'pending-image-sha256'}`]);
        }
        else if (submission.externalImageUrl?.trim()) {
            tags.push(['image', submission.externalImageUrl.trim()]);
        }
        if (!title) {
            validationIssues.push({
                level: 'error',
                code: 'MISSING_TITLE',
                field: 'title',
                message: 'Long-form articles (Kind 30023) require a title.',
            });
        }
        if (!content) {
            validationIssues.push({
                level: 'error',
                code: 'EMPTY_BODY',
                field: 'content',
                message: 'Article body cannot be empty.',
            });
        }
    }
    else if (detectedCategory === 'photo') {
        kind = 20;
        const primaryImage = imageAssets[0];
        title = title || (primaryImage ? titleFromFilename(primaryImage.name) : 'Photo');
        if (title)
            tags.push(['title', title]);
        if (license)
            tags.push(['license', license]);
        if (imageAssets.length > 0) {
            for (const img of imageAssets) {
                const blobBase = targetBlossomServers[0]?.replace(/\/$/, '') || 'https://blossom.pending';
                const hash = img.sha256 || 'pending-image-sha256';
                tags.push([
                    'imeta',
                    `url ${blobBase}/${hash}`,
                    `m ${img.mimeType || 'image/jpeg'}`,
                    `x ${hash}`,
                    `size ${img.sizeBytes}`,
                    `alt ${submission.externalAlt?.trim() || title || img.name}`,
                ]);
            }
        }
        else if (submission.externalImageUrl?.trim()) {
            const extUrl = submission.externalImageUrl.trim();
            const shaMatch = extUrl.match(/\/([0-9a-f]{64})(?:[.?/#]|$)/i);
            const imeta = [`url ${extUrl}`, 'm image/jpeg'];
            if (shaMatch)
                imeta.push(`x ${shaMatch[1].toLowerCase()}`);
            if (submission.externalAlt?.trim() || title) {
                imeta.push(`alt ${submission.externalAlt?.trim() || title}`);
            }
            tags.push(['imeta', ...imeta]);
        }
        else {
            validationIssues.push({
                level: 'error',
                code: 'MISSING_IMAGE',
                field: 'assets',
                message: 'Select at least one image or provide an existing Blossom image URL for a photo publication.',
            });
        }
    }
    else if (detectedCategory === 'nsite') {
        nsiteAnalysis = analyzeNsiteIdentity({
            existingSites,
            assets,
            requestedMode: submission.targetSiteMode,
            requestedSlug: submission.targetSiteSlug || submission.existingDTag,
        });
        kind = nsiteAnalysis.recommendedKind;
        dTag = nsiteAnalysis.recommendedDTag;
        title =
            title ||
                nsiteAnalysis.existingTarget?.title ||
                (dTag ? titleFromFilename(dTag) : 'Root Nsite');
        summary =
            summary ||
                `${assets.length} static asset${assets.length === 1 ? '' : 's'} prepared for ${nsiteAnalysis.detectedMode} nsite.`;
        content = content || summary;
        if (dTag)
            tags.push(['d', dTag]);
        tags.push(['title', title]);
        tags.push(['description', summary]);
        for (const asset of assets) {
            const normalizedPath = (asset.path || asset.name).startsWith('/')
                ? asset.path || asset.name
                : `/${asset.path || asset.name}`;
            tags.push(['path', normalizedPath, asset.sha256 || 'pending-sha256']);
        }
        for (const server of targetBlossomServers) {
            tags.push(['server', server]);
        }
        if (assets.length === 0) {
            validationIssues.push({
                level: 'error',
                code: 'EMPTY_NSITE',
                field: 'assets',
                message: 'Add a site folder, ZIP bundle, or HTML/CSS/JS files to publish an nsite.',
            });
        }
        for (const w of nsiteAnalysis.warnings) {
            validationIssues.push({
                level: nsiteAnalysis.rootOverwriteRisk ? 'warning' : 'info',
                code: nsiteAnalysis.rootOverwriteRisk ? 'ROOT_NSITE_GUARD' : 'NSITE_NOTICE',
                message: w,
            });
        }
    }
    else if (detectedCategory === 'file') {
        kind = 1063;
        const file = assets[0];
        title = title || (file ? titleFromFilename(file.name) : 'File');
        if (file) {
            const blobBase = targetBlossomServers[0]?.replace(/\/$/, '') || 'https://blossom.pending';
            const hash = file.sha256 || 'pending-file-sha256';
            tags.push(['url', `${blobBase}/${hash}`]);
            tags.push(['m', file.mimeType || 'application/octet-stream']);
            tags.push(['x', hash]);
            tags.push(['size', String(file.sizeBytes)]);
            if (title)
                tags.push(['alt', title]);
        }
        else {
            validationIssues.push({
                level: 'error',
                code: 'MISSING_FILE',
                field: 'assets',
                message: 'Select a file to prepare a NIP-94 file metadata event.',
            });
        }
        if (license)
            tags.push(['license', license]);
    }
    else {
        // post (Kind 1)
        kind = 1;
        title = title || (content ? content.slice(0, 56) : 'Short Note');
        if (!content) {
            validationIssues.push({
                level: 'error',
                code: 'EMPTY_NOTE',
                field: 'content',
                message: 'Write a short message before publishing a note.',
            });
        }
    }
    // Add default inferred hashtags only for music/article if none explicitly entered
    if (hashtags.size === 0 &&
        (detectedCategory === 'music' || detectedCategory === 'article') &&
        preferences.defaultHashtags.value) {
        for (const t of preferences.defaultHashtags.value.slice(0, 2)) {
            hashtags.add(t);
        }
    }
    const sortedHashtags = Array.from(hashtags);
    for (const tag of sortedHashtags) {
        tags.push(['t', tag]);
    }
    // Destination checks
    if (targetRelays.length === 0) {
        validationIssues.push({
            level: 'error',
            code: 'NO_WRITE_RELAYS',
            field: 'relays',
            message: 'Configure at least one write relay before publishing.',
        });
    }
    if (assets.length > 0 && targetBlossomServers.length === 0) {
        validationIssues.push({
            level: 'warning',
            code: 'NO_BLOSSOM_SERVERS',
            field: 'blossom',
            message: 'Assets detected, but no Blossom server is configured. Add a Blossom server to host media blobs.',
        });
    }
    const kindSpec = getKindSpec(kind);
    const hasErrors = validationIssues.some((v) => v.level === 'error');
    return {
        detectedCategory,
        confidence,
        rationale,
        kind,
        kindLabel: kindSpec.label,
        nipRef: kindSpec.nip,
        title,
        summary,
        content,
        artist,
        license,
        dTag,
        hashtags: sortedHashtags,
        tags,
        assetsToUpload: assets,
        targetRelays,
        targetBlossomServers,
        appliedPreferences,
        appliedCorrections,
        nsiteAnalysis,
        validationIssues,
        readyToPublish: !hasErrors,
    };
}
/**
 * Audit relay replication and Blossom media coverage across active publications.
 */
export function auditCoverage(publications, nowSec = Math.floor(Date.now() / 1000)) {
    const active = publications.filter((p) => !p.deleted);
    const gaps = [];
    let healthyCount = 0;
    let degradedCount = 0;
    let criticalCount = 0;
    let relayRatioSum = 0;
    let mediaRatioSum = 0;
    let mediaCheckedCount = 0;
    for (const pub of active) {
        const publishedSet = new Set(pub.publishedRelays);
        const missingRelays = pub.expectedRelays.filter((r) => !publishedSet.has(r));
        const relayCoverageRatio = pub.expectedRelays.length > 0
            ? (pub.expectedRelays.length - missingRelays.length) / pub.expectedRelays.length
            : 1;
        relayRatioSum += relayCoverageRatio;
        const missingAssets = [];
        let totalAssetSlots = 0;
        let presentAssetSlots = 0;
        for (const hash of pub.assetHashes) {
            const present = new Set(pub.assetLocations[hash] || []);
            const missingServers = pub.expectedBlossomServers.filter((s) => !present.has(s));
            totalAssetSlots += pub.expectedBlossomServers.length;
            presentAssetSlots += pub.expectedBlossomServers.length - missingServers.length;
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
        }
        else if (missingRelays.length > 0 || missingAssets.length > 0) {
            status = 'degraded';
            degradedCount += 1;
        }
        else {
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
export function recordCorrection(existing, next, nowSec = Math.floor(Date.now() / 1000)) {
    if (next.previousValue === next.correctedValue || !next.correctedValue.trim()) {
        return existing;
    }
    const filtered = existing.filter((c) => !(c.contentType === next.contentType && c.field === next.field));
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
export function summarizeObservedActivity(records, queriedRelays) {
    const counts = {
        reply: 0,
        reaction: 0,
        repost: 0,
        mention: 0,
        follower: 0,
    };
    for (const r of records) {
        counts[r.type] += 1;
    }
    const relayCount = queriedRelays.length;
    const provenanceStatement = relayCount > 0
        ? `Observed across ${relayCount} queried relay${relayCount === 1 ? '' : 's'} — counts reflect received events, not global totals.`
        : 'No relays queried yet — connect or refresh relays to observe incoming events.';
    return {
        queriedRelays,
        totalObserved: records.length,
        counts,
        provenanceStatement,
    };
}
