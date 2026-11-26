/**
 * Universal intelligent content detection and event preparation pipeline.
 */
import { getKindSpec } from '../nipRegistry.js';
import { nsitePath, slug } from '../../core/urls.js';
import { safeHttpUrl } from '../../core/guards.js';
import {
  slugify,
  titleFromFilename,
  isAudioAsset,
  isImageAsset,
  isMarkdownAsset,
  isSiteArchiveOrHtml,
  extractMarkdownFrontmatter,
  extractInlineHashtags,
} from './helpers.js';
import { analyzeNsiteIdentity } from './identity-preferences.js';

/**
 * Find the most recent learned correction for a field and content category.
 */
function findCorrection(corrections, contentType, field) {
  if (!Array.isArray(corrections)) return undefined;
  return [...corrections]
    .sort((a, b) => (b?.recordedAt || 0) - (a?.recordedAt || 0))
    .find((c) => c && c.field === field && (c.contentType === contentType || c.contentType === 'all'));
}

/**
 * Universal `+` Intelligent Preparation Pipeline:
 * Detect content -> recover preferences -> apply learned corrections -> prepare minimal tags -> validate.
 */
export function detectAndPrepareContent(params = {}) {
  const safeParams = params && typeof params === 'object' ? params : {};
  const submission = safeParams.submission && typeof safeParams.submission === 'object' ? safeParams.submission : {};
  const preferences = safeParams.preferences && typeof safeParams.preferences === 'object' ? safeParams.preferences : {};
  const corrections = Array.isArray(safeParams.corrections) ? safeParams.corrections : [];
  const existingSites = Array.isArray(safeParams.existingSites) ? safeParams.existingSites : [];

  const assets = Array.isArray(submission.assets) ? submission.assets : [];
  const text = String(submission.text || '').trim();
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
  } else if (
    siteAssets.length > 0 ||
    (assets.length >= 2 && assets.some((a) => /\.(html?|css|js)$/i.test(a?.name || '')))
  ) {
    detectedCategory = 'nsite';
    rationale = 'Detected web entry/bundle files (HTML/ZIP/static assets); preparing nsite manifest.';
  } else if (audioAssets.length > 0) {
    detectedCategory = 'music';
    rationale =
      imageAssets.length > 0
        ? `Detected audio track (${audioAssets[0].name}) paired with cover artwork (${imageAssets[0].name}); preparing Kind 31337 music release.`
        : `Detected audio file (${audioAssets[0].name}); preparing Kind 31337 music release.`;
  } else if (
    markdownAssets.length > 0 ||
    text.length > 320 ||
    /^#\s+.+/m.test(text) ||
    text.startsWith('---')
  ) {
    detectedCategory = 'article';
    rationale = 'Detected structured Markdown or long-form prose; preparing NIP-23 addressable article (Kind 30023).';
  } else if (imageAssets.length > 0 && assets.length === imageAssets.length) {
    detectedCategory = 'photo';
    rationale = `Detected ${imageAssets.length} image asset${imageAssets.length > 1 ? 's' : ''}; preparing NIP-68 picture publication (Kind 20).`;
  } else if (assets.length > 0) {
    detectedCategory = 'file';
    rationale = `Detected general file (${assets[0].name}); preparing NIP-94 file metadata event (Kind 1063).`;
  } else {
    detectedCategory = 'post';
    confidence = text.length > 0 ? 'high' : 'medium';
    rationale = 'Detected concise text content; preparing standard NIP-01 short note (Kind 1).';
  }

  // 2. Recover preferences & apply learned corrections
  const appliedPreferences = [];
  const appliedCorrections = [];
  const targetRelays = Array.isArray(preferences?.defaultWriteRelays?.value) ? preferences.defaultWriteRelays.value : [];
  if (targetRelays.length > 0) {
    appliedPreferences.push(`Write relays (${targetRelays.length}) from ${preferences.defaultWriteRelays.provenance}`);
  }
  const blossomCorrection = findCorrection(corrections, detectedCategory, 'blossomServer');
  const targetBlossomServers = blossomCorrection
    ? [blossomCorrection.correctedValue]
    : Array.isArray(preferences?.defaultBlossomServers?.value)
      ? preferences.defaultBlossomServers.value
      : [];
  if (blossomCorrection) {
    appliedCorrections.push(`Blossom target overridden to ${blossomCorrection.correctedValue}`);
  } else if (targetBlossomServers.length > 0) {
    appliedPreferences.push(`Blossom servers (${targetBlossomServers.length}) from ${preferences.defaultBlossomServers.provenance}`);
  }
  const artistCorrection = findCorrection(corrections, detectedCategory, 'artist');
  const artist = artistCorrection?.correctedValue || preferences?.artistOrAuthorName?.value || undefined;
  if (artistCorrection) {
    appliedCorrections.push(`Artist attribution set to "${artistCorrection.correctedValue}"`);
  } else if (artist) {
    appliedPreferences.push(`Attribution "${artist}" (${preferences.artistOrAuthorName?.provenance || 'recovered'})`);
  }
  const licenseCorrection = findCorrection(corrections, detectedCategory, 'license');
  const license = licenseCorrection?.correctedValue || preferences?.preferredLicense?.value || undefined;
  if (licenseCorrection) {
    appliedCorrections.push(`License set to "${licenseCorrection.correctedValue}"`);
  } else if (license) {
    appliedPreferences.push(`License "${license}" (${preferences.preferredLicense?.provenance || 'inferred'})`);
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
    if (title) tags.push(['title', title]);
    if (artist) tags.push(['artist', artist]);
    if (license) tags.push(['license', license]);
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
      tags.push(['url', resolvedAudioUrl]);
      tags.push(['format', resolvedAudioMime]);
      const imetaEntries = [`url ${resolvedAudioUrl}`, `m ${resolvedAudioMime}`];
      if (resolvedAudioHash) imetaEntries.push(`x ${resolvedAudioHash}`);
      if (primaryAudio?.sizeBytes) imetaEntries.push(`size ${primaryAudio.sizeBytes}`);
      tags.push(['imeta', ...imetaEntries]);
      if (resolvedDuration && resolvedDuration > 0) {
        tags.push(['duration', String(Math.round(resolvedDuration))]);
      }
    } else {
      validationIssues.push({
        level: 'error',
        code: 'MISSING_AUDIO',
        field: 'assets',
        message: 'Add an audio file (.mp3, .flac, .wav, .ogg) or a direct Blossom audio URL to publish a music release.',
      });
    }
    const safeCoverUrl = submission.externalCoverUrl?.trim()
      ? safeHttpUrl(submission.externalCoverUrl.trim(), { allowHttp: true, maxLength: 4096 })
      : null;
    if (submission.externalCoverUrl?.trim() && !safeCoverUrl) {
      validationIssues.push({
        level: 'error',
        code: 'INVALID_EXTERNAL_URL',
        field: 'externalCoverUrl',
        message: 'External cover URL must use a valid http(s) URL without credentials.',
      });
    }
    const resolvedCoverUrl = coverImage
      ? `${blobBase}/${coverImage.sha256 || 'pending-cover-sha256'}`
      : safeCoverUrl;
    if (resolvedCoverUrl) {
      tags.push(['image', resolvedCoverUrl]);
    } else {
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
    if (kind === 36787) hashtags.add('nostrmusic');
  } else if (detectedCategory === 'article') {
    kind = 30023;
    const rawMd = markdownAssets[0]?.textPreview || text;
    const parsed = extractMarkdownFrontmatter(rawMd);
    title = title || parsed.title || (markdownAssets[0] ? titleFromFilename(markdownAssets[0].name) : '');
    summary = summary || parsed.summary || '';
    content = parsed.body || text;
    for (const t of parsed.tags) hashtags.add(t);
    dTag = dTag || slugify(title || 'article');
    tags.push(['d', dTag]);
    if (title) tags.push(['title', title]);
    if (summary) tags.push(['summary', summary]);
    if (license) tags.push(['license', license]);
    tags.push(['published_at', String(submission.publishedAt || Math.floor(Date.now() / 1000))]);
    if (imageAssets[0]) {
      const blobBase = targetBlossomServers[0]?.replace(/\/$/, '') || 'https://blossom.pending';
      tags.push(['image', `${blobBase}/${imageAssets[0].sha256 || 'pending-image-sha256'}`]);
    } else if (submission.externalImageUrl?.trim()) {
      const safeImg = safeHttpUrl(submission.externalImageUrl.trim(), { allowHttp: true, maxLength: 4096 });
      if (safeImg) {
        tags.push(['image', safeImg]);
      } else {
        validationIssues.push({
          level: 'error',
          code: 'INVALID_EXTERNAL_URL',
          field: 'externalImageUrl',
          message: 'External image URL must use a valid http(s) URL without credentials.',
        });
      }
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
  } else if (detectedCategory === 'photo') {
    kind = 20;
    const primaryImage = imageAssets[0];
    title = title || (primaryImage ? titleFromFilename(primaryImage.name) : 'Photo');
    if (title) tags.push(['title', title]);
    if (license) tags.push(['license', license]);
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
    } else if (submission.externalImageUrl?.trim()) {
      const extUrl = safeHttpUrl(submission.externalImageUrl.trim(), { allowHttp: true, maxLength: 4096 });
      if (!extUrl) {
        validationIssues.push({
          level: 'error',
          code: 'INVALID_EXTERNAL_URL',
          field: 'externalImageUrl',
          message: 'External image URL must use a valid http(s) URL without credentials.',
        });
      } else {
        const shaMatch = extUrl.match(/\/([0-9a-f]{64})(?:[.?/#]|$)/i);
        const imeta = [`url ${extUrl}`, 'm image/jpeg'];
        if (shaMatch) imeta.push(`x ${shaMatch[1].toLowerCase()}`);
        if (submission.externalAlt?.trim() || title) {
          imeta.push(`alt ${submission.externalAlt?.trim() || title}`);
        }
        tags.push(['imeta', ...imeta]);
      }
    } else {
      validationIssues.push({
        level: 'error',
        code: 'MISSING_IMAGE',
        field: 'assets',
        message: 'Select at least one image or provide an existing Blossom image URL for a photo publication.',
      });
    }
  } else if (detectedCategory === 'nsite') {
    nsiteAnalysis = analyzeNsiteIdentity({
      existingSites,
      assets,
      requestedMode: submission.targetSiteMode,
      requestedSlug: submission.targetSiteSlug || submission.existingDTag,
    });
    kind = nsiteAnalysis.recommendedKind;
    dTag = nsiteAnalysis.recommendedDTag;
    if (kind === 35128 && dTag) {
      try {
        slug(dTag);
      } catch {
        validationIssues.push({
          level: 'error',
          code: 'INVALID_NSITE_SLUG',
          field: 'dTag',
          message: 'Named nsite identifier must be 1–13 lowercase alphanumeric/hyphen characters without a trailing hyphen.',
        });
      }
    }
    title = title || nsiteAnalysis.existingTarget?.title || (dTag ? titleFromFilename(dTag) : 'Root Nsite');
    summary =
      summary ||
      `${assets.length} static asset${assets.length === 1 ? '' : 's'} prepared for ${nsiteAnalysis.detectedMode} nsite.`;
    content = content || summary;
    if (dTag) tags.push(['d', dTag]);
    tags.push(['title', title]);
    tags.push(['description', summary]);
    for (const asset of assets) {
      try {
        const normalizedPath = nsitePath(asset.path || asset.name);
        tags.push(['path', normalizedPath, asset.sha256 || 'pending-sha256']);
      } catch {
        validationIssues.push({
          level: 'error',
          code: 'UNSAFE_ASSET_PATH',
          field: 'assets',
          message: `Unsafe nsite asset path rejected: ${asset.path || asset.name}`,
        });
      }
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
  } else if (detectedCategory === 'file') {
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
      if (title) tags.push(['alt', title]);
    } else {
      validationIssues.push({
        level: 'error',
        code: 'MISSING_FILE',
        field: 'assets',
        message: 'Select a file to prepare a NIP-94 file metadata event.',
      });
    }
    if (license) tags.push(['license', license]);
  } else {
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

  if (
    hashtags.size === 0 &&
    (detectedCategory === 'music' || detectedCategory === 'article') &&
    Array.isArray(preferences?.defaultHashtags?.value)
  ) {
    for (const t of preferences.defaultHashtags.value.slice(0, 2)) {
      hashtags.add(t);
    }
  }
  const sortedHashtags = Array.from(hashtags);
  for (const tag of sortedHashtags) {
    tags.push(['t', tag]);
  }

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
  const hasPendingPlaceholders = tags.some(
    (tag) =>
      Array.isArray(tag) &&
      tag.some(
        (cell) =>
          typeof cell === 'string' &&
          /\bblossom\.pending\b|\bpending(?:-[a-z]+)?-sha256\b/i.test(cell)
      )
  );
  if (hasPendingPlaceholders) {
    validationIssues.push({
      level: 'error',
      code: 'PENDING_BLOB_UPLOAD',
      field: 'tags',
      message: 'Upload pending media blobs and replace placeholder URLs or hashes before publishing.',
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
