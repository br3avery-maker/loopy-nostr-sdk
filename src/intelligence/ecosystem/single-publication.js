/**
 * Single-publication Nostr ecosystem audit.
 */
import { ECOSYSTEM_DISCOVERY_RELAYS } from '../nipRegistry.js';
import {
  AUDIO_URL_RE,
  IMAGE_URL_RE,
  BLOSSOM_SHA_URL_RE,
  MUSIC_DOMAIN_RE,
  isLikelyMusicNsite,
  slugifyShort,
  getTagValue,
  getImetaFields,
  inferTagsFromText,
  isBareUrlNote,
  mergeRelays,
  clampScore,
  normalizeProfile,
  normalizePublication,
} from './helpers.js';

/**
 * Audit a single publication against Nostr ecosystem client specs.
 */
export function auditSinglePublication(params = {}) {
  const safeParams = params && typeof params === 'object' ? params : {};
  const pub = normalizePublication(safeParams.pub);
  const profile = normalizeProfile(safeParams.profile);
  const healthyWriteRelays = Array.isArray(safeParams.healthyWriteRelays) ? safeParams.healthyWriteRelays : [];
  const preferredLicense = safeParams.preferredLicense;
  const authorName = profile.display_name || profile.name || pub.artist || '';
  const imetas = getImetaFields(pub.tags);
  const missingTags = [];
  const clientCompatibility = [];
  let score = 100;
  let diagnosis = 'Formatted cleanly for ecosystem clients.';
  let prefillDraft;
  let recommendedRelays = mergeRelays(healthyWriteRelays, ECOSYSTEM_DISCOVERY_RELAYS.generalOutbox, 4);
  let suggestedHashtags = [];

  /* ------------------------------ MUSIC EVENTS ----------------------------- */
  if (pub.kind === 36787 || pub.kind === 31337 || pub.kind === 32123 || pub.category === 'music') {
    recommendedRelays = mergeRelays(healthyWriteRelays, ECOSYSTEM_DISCOVERY_RELAYS.music, 5);
    const hasD = Boolean(getTagValue(pub.tags, 'd'));
    const hasTitle = Boolean(getTagValue(pub.tags, 'title'));
    const hasArtist = Boolean(getTagValue(pub.tags, 'artist'));
    const directUrl = getTagValue(pub.tags, 'url') || imetas.find((m) => m.url)?.url;
    const hasImeta = imetas.length > 0;
    const hasImage = Boolean(getTagValue(pub.tags, 'image'));
    const hasDuration = Boolean(getTagValue(pub.tags, 'duration'));
    const hasLicense = Boolean(getTagValue(pub.tags, 'license'));
    const hasZap = pub.tags.some((t) => Array.isArray(t) && t[0] === 'zap' && t[1]);
    const hasGenreTags = pub.hashtags.length > 0;
    if (pub.kind !== 36787) {
      missingTags.push('kind:36787 (modern NIP-Music track)');
      score -= 18;
    }
    if (!hasD) {
      missingTags.push('d (track slug)');
      score -= 12;
    }
    if (!hasTitle) {
      missingTags.push('title');
      score -= 14;
    }
    if (!hasArtist) {
      missingTags.push('artist');
      score -= 12;
    }
    if (!directUrl) {
      missingTags.push('url (direct Blossom audio stream)');
      score -= 22;
    }
    if (!hasImeta) {
      missingTags.push('imeta (url, m, x, size)');
      score -= 10;
    }
    if (!hasImage) {
      missingTags.push('image (cover artwork)');
      score -= 12;
    }
    if (!hasDuration) {
      missingTags.push('duration (seconds)');
      score -= 6;
    }
    if (!hasGenreTags) {
      missingTags.push('t (genre & #nostrmusic hashtags)');
      score -= 10;
    }
    if (!hasLicense) {
      missingTags.push('license');
      score -= 5;
    }
    if (!hasZap && !profile.lud16) {
      missingTags.push('zap / lud16 (V4V splits)');
      score -= 6;
    }
    suggestedHashtags = inferTagsFromText(`${pub.title} ${pub.summary} ${pub.content}`, pub.hashtags, ['nostrmusic', 'music']);
    const amethystReady = pub.kind === 36787 && hasD && hasTitle && hasArtist && Boolean(directUrl) && hasImage;
    clientCompatibility.push({
      clientName: 'Amethyst · Gruuv · Wisp',
      status: amethystReady ? 'ready' : pub.kind === 36787 && directUrl ? 'partial' : 'invisible',
      reason: amethystReady
        ? 'Kind 36787 with direct stream URL, artist, and cover art.'
        : pub.kind !== 36787
          ? `Published as Kind ${pub.kind}; modern music clients prioritize Kind 36787 with direct audio url + cover art.`
          : `Missing ${missingTags.slice(0, 3).join(', ')} for full player rendering.`,
    });
    clientCompatibility.push({
      clientName: 'Zapstr · Legacy Audio',
      status: (pub.kind === 31337 || pub.kind === 36787) && Boolean(directUrl) && hasTitle ? 'ready' : 'partial',
      reason: directUrl ? 'Direct audio stream present.' : 'No direct audio URL/imeta found.',
    });
    clientCompatibility.push({
      clientName: 'Wavlake · Fountain (V4V)',
      status: Boolean(directUrl) && (hasZap || Boolean(profile.lud16)) && hasImage ? 'partial' : 'invisible',
      reason: !profile.lud16 && !hasZap
        ? 'Missing Lightning Address (lud16) or zap split tag for Value-for-Value music splits.'
        : 'Broadcast to wss://relay.wavlake.com with complete Kind 36787 tags for music indexing.',
    });
    diagnosis =
      missingTags.length === 0
        ? 'Complete Kind 36787 music release ready for streaming clients.'
        : `Missing ${missingTags.slice(0, 4).join(', ')} — music publishers will drop or under-rank this track.`;
    if (score < 95) {
      prefillDraft = {
        label: `Upgrade "${pub.title}" to Kind 36787 Music Spec`,
        rationale: `Reformats "${pub.title}" as a complete Kind 36787 music track with direct audio URL, imeta, cover art slot, genre tags, and music discovery relays.`,
        category: 'music',
        musicKindPreference: 36787,
        title: pub.title,
        summary: pub.summary || `${pub.title}${authorName ? ` by ${authorName}` : ''}`,
        content: pub.content || pub.summary || '',
        artist: pub.artist || authorName || undefined,
        license: pub.license || preferredLicense || 'CC BY-SA 4.0',
        dTag: pub.dTag || slugifyShort(pub.title),
        hashtags: Array.from(new Set([...pub.hashtags, ...suggestedHashtags])),
        externalAudioUrl: directUrl,
        externalAudioMime: imetas[0]?.m || 'audio/mpeg',
        externalAudioSha256: imetas[0]?.x || pub.assets.find((a) => a.role === 'audio')?.sha256,
        externalCoverUrl: getTagValue(pub.tags, 'image'),
        recommendedRelays,
        sourcePublicationId: pub.id,
      };
    }
  } else if (pub.kind === 30023 || pub.category === 'article') {
    /* ---------------------------- LONG-FORM 30023 ---------------------------- */
    recommendedRelays = mergeRelays(healthyWriteRelays, ECOSYSTEM_DISCOVERY_RELAYS.articles, 5);
    const hasD = Boolean(getTagValue(pub.tags, 'd'));
    const hasTitle = Boolean(getTagValue(pub.tags, 'title'));
    const hasSummary = Boolean(getTagValue(pub.tags, 'summary'));
    const hasImage = Boolean(getTagValue(pub.tags, 'image'));
    const hasPublishedAt = Boolean(getTagValue(pub.tags, 'published_at'));
    const hasTags = pub.hashtags.length > 0;
    if (!hasD) {
      missingTags.push('d (stable article slug)');
      score -= 20;
    }
    if (!hasTitle) {
      missingTags.push('title');
      score -= 20;
    }
    if (!hasSummary) {
      missingTags.push('summary (feed preview excerpt)');
      score -= 18;
    }
    if (!hasImage) {
      missingTags.push('image (header cover banner)');
      score -= 18;
    }
    if (!hasPublishedAt) {
      missingTags.push('published_at (original timestamp)');
      score -= 10;
    }
    if (!hasTags) {
      missingTags.push('t (topic hashtags)');
      score -= 14;
    }
    suggestedHashtags = inferTagsFromText(`${pub.title} ${pub.summary} ${pub.content}`, pub.hashtags, ['nostr']);
    clientCompatibility.push({
      clientName: 'Yakihonne · Habla · Highlighter',
      status: score >= 85 ? 'ready' : score >= 55 ? 'partial' : 'invisible',
      reason: missingTags.length === 0
        ? 'Full NIP-23 card metadata (title, summary, banner image, published_at, tags).'
        : `Renders without ${missingTags.slice(0, 3).join(', ')}, reducing click-through in reader feeds.`,
    });
    diagnosis =
      missingTags.length === 0
        ? 'Complete NIP-23 long-form article metadata.'
        : `Article is missing ${missingTags.join(', ')} needed for rich cards on Yakihonne and Habla.`;
    if (score < 95) {
      const cleanSummary = getTagValue(pub.tags, 'summary') ||
        pub.content
          .replace(/^#+\s+.+$/gm, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 160);
      prefillDraft = {
        label: `Optimize article "${pub.title}" (Kind 30023)`,
        rationale: `Preserves d-tag "${pub.dTag || slugifyShort(pub.title)}" while adding missing NIP-23 summary, published_at, topic tags, and Yakihonne relay routing.`,
        category: 'article',
        title: pub.title,
        summary: cleanSummary,
        content: pub.content,
        license: pub.license || preferredLicense,
        dTag: pub.dTag || slugifyShort(pub.title),
        hashtags: Array.from(new Set([...pub.hashtags, ...suggestedHashtags])),
        externalImageUrl: getTagValue(pub.tags, 'image'),
        publishedAt: Number(getTagValue(pub.tags, 'published_at')) || pub.createdAt,
        recommendedRelays,
        sourcePublicationId: pub.id,
      };
    }
  } else if (pub.kind === 20 || pub.category === 'photo') {
    /* ---------------------------- NIP-68 KIND 20 ----------------------------- */
    recommendedRelays = mergeRelays(healthyWriteRelays, ECOSYSTEM_DISCOVERY_RELAYS.photos, 4);
    const firstImeta = imetas[0] || {};
    const hasImetaUrl = Boolean(firstImeta.url);
    const hasMime = Boolean(firstImeta.m);
    const hasHash = Boolean(firstImeta.x);
    const hasAlt = Boolean(firstImeta.alt || getTagValue(pub.tags, 'alt'));
    const hasRealTitle = Boolean(getTagValue(pub.tags, 'title')) && !/^Photo [0-9a-f]{6,}/i.test(pub.title);
    const hasTags = pub.hashtags.length > 0;
    if (!hasImetaUrl) {
      missingTags.push('imeta url');
      score -= 35;
    }
    if (!hasMime) {
      missingTags.push('imeta m (MIME)');
      score -= 10;
    }
    if (!hasHash) {
      missingTags.push('imeta x (SHA-256)');
      score -= 10;
    }
    if (!hasAlt) {
      missingTags.push('alt (image description)');
      score -= 18;
    }
    if (!hasRealTitle) {
      missingTags.push('title (human-readable caption)');
      score -= 15;
    }
    if (!hasTags) {
      missingTags.push('t (topic hashtags)');
      score -= 12;
    }
    suggestedHashtags = inferTagsFromText(`${pub.title} ${pub.content}`, pub.hashtags, ['photography', 'art']);
    clientCompatibility.push({
      clientName: 'Olas · Primal · Amethyst Pictures',
      status: hasImetaUrl && hasAlt && hasTags ? 'ready' : hasImetaUrl ? 'partial' : 'invisible',
      reason: !hasImetaUrl
        ? 'Missing imeta url — picture clients cannot render the image.'
        : missingTags.length > 0
          ? `Renders image, but missing ${missingTags.join(', ')} hurts search, accessibility, and discovery.`
          : 'Complete NIP-68 picture metadata.',
    });
    diagnosis =
      missingTags.length === 0
        ? 'Well-formatted NIP-68 picture publication.'
        : `Photo post is missing ${missingTags.join(', ')}; picture feeds display it with generic fallback labels.`;
    if (score < 95 && (firstImeta.url || pub.assets[0]?.urls[0])) {
      const imgUrl = firstImeta.url || pub.assets[0]?.urls[0];
      prefillDraft = {
        label: `Polish photo "${pub.title}" (Kind 20)`,
        rationale: 'Adds proper NIP-68 title, alt text, imeta fields, and discovery hashtags for Olas and Primal.',
        category: 'photo',
        title: hasRealTitle ? pub.title : '',
        summary: pub.content || '',
        content: pub.content || '',
        hashtags: Array.from(new Set([...pub.hashtags, ...suggestedHashtags])),
        externalImageUrl: imgUrl,
        externalAlt: firstImeta.alt || getTagValue(pub.tags, 'alt') || '',
        recommendedRelays,
        sourcePublicationId: pub.id,
      };
    }
  } else if (pub.kind === 15128 || pub.kind === 35128 || pub.kind === 34128 || pub.category === 'nsite') {
    /* ---------------------------- NSITE MANIFESTS ---------------------------- */
    recommendedRelays = mergeRelays(healthyWriteRelays, ECOSYSTEM_DISCOVERY_RELAYS.nsites, 5);
    const pathTags = pub.tags.filter((t) => Array.isArray(t) && t[0] === 'path' && t[1] && t[2]);
    const hasIndexHtml =
      pathTags.some((t) => /^\/?index\.html?$/i.test(t[1])) ||
      pub.assets.some((a) => /^\/?index\.html?$/i.test(a.path || a.name));
    const hasTitle = Boolean(getTagValue(pub.tags, 'title'));
    const hasDescription = Boolean(getTagValue(pub.tags, 'description'));
    const hasServerHint = pub.tags.some((t) => Array.isArray(t) && t[0] === 'server' && typeof t[1] === 'string' && t[1].startsWith('https://'));
    const dTag = getTagValue(pub.tags, 'd') || pub.dTag || '';
    const dTooLong = pub.kind === 35128 && dTag.length > 13;
    const audioPaths = pub.assets.filter((a) => a.mimeType.startsWith('audio/') || /\.(mp3|flac|wav|ogg|m4a|opus)$/i.test(a.path || a.name));
    const looksLikeMusicSite = isLikelyMusicNsite(pub, audioPaths);
    if (pub.kind === 34128) {
      missingTags.push('migrate Kind 34128 → Kind 15128');
      score -= 25;
    }
    if (!hasIndexHtml) {
      missingTags.push('/index.html entry path');
      score -= 25;
    }
    if (!hasTitle) {
      missingTags.push('title');
      score -= 12;
    }
    if (!hasDescription) {
      missingTags.push('description');
      score -= 10;
    }
    if (!hasServerHint) {
      missingTags.push('server (Blossom fallback hints)');
      score -= 8;
    }
    if (dTooLong) {
      missingTags.push('d slug <= 13 chars for subdomain routing');
      score -= 15;
    }
    if (looksLikeMusicSite) {
      missingTags.push('companion Kind 36787 track events for Nostr music clients');
      score -= 15;
    }
    clientCompatibility.push({
      clientName: 'Nsite Gateways (nsite.lol)',
      status: hasIndexHtml && !dTooLong && pub.kind !== 34128 ? 'ready' : 'partial',
      reason: hasIndexHtml && !dTooLong && pub.kind !== 34128
        ? `Manifest maps ${pub.assets.length} SHA-256 files with /index.html.`
        : `Gateway caveat: ${missingTags.filter((m) => !m.includes('36787')).join(', ') || 'check Blossom mirroring'}.`,
    });
    if (looksLikeMusicSite) {
      clientCompatibility.push({
        clientName: 'Amethyst · Gruuv · Wavlake (Music)',
        status: 'invisible',
        reason: `Audio hosted inside a Kind ${pub.kind} nsite web player cannot be indexed by Nostr music clients until published as Kind 36787 track events.`,
      });
      const firstAudio = audioPaths[0];
      const coverAsset = pub.assets.find(
        (a) => a.mimeType.startsWith('image/') && /(cover|art|thumb|poster|album)/i.test(a.path || a.name)
      );
      suggestedHashtags = inferTagsFromText(`${pub.title} ${pub.summary} ${dTag}`, pub.hashtags, ['nostrmusic', 'music', 'v4v']);
      prefillDraft = {
        label: `Extract Kind 36787 track from "${pub.title}"`,
        rationale: `"${pub.title}" is a Kind ${pub.kind} web nsite (d="${dTag}"). Music clients cannot index web apps—publishing each song as a Kind 36787 event pointing at your Blossom audio makes it streamable natively across Amethyst, Gruuv, and Wavlake.`,
        category: 'music',
        musicKindPreference: 36787,
        title: pub.title.replace(/\s*[·\-–|]\s*music\s*player.*$/i, '').trim() || pub.title,
        summary: `Streaming release from ${pub.title}${authorName ? ` by ${authorName}` : ''}`,
        content: `Listen natively on Nostr music clients or explore the full player at nsite "${dTag}".`,
        artist: authorName || undefined,
        license: preferredLicense || 'CC BY-SA 4.0',
        dTag: slugifyShort(dTag || pub.title, 24),
        hashtags: suggestedHashtags,
        externalAudioUrl: firstAudio?.urls[0],
        externalAudioMime: firstAudio?.mimeType,
        externalAudioSha256: firstAudio?.sha256,
        externalCoverUrl: coverAsset?.urls[0],
        recommendedRelays: mergeRelays(healthyWriteRelays, ECOSYSTEM_DISCOVERY_RELAYS.music, 5),
        sourcePublicationId: pub.id,
      };
    }
    diagnosis = looksLikeMusicSite
      ? `Web nsite works on gateways, but music inside "${pub.title}" is invisible to Nostr music publishers until released as Kind 36787 tracks.`
      : missingTags.length === 0
        ? 'Clean NIP-5A nsite manifest with /index.html.'
        : `Nsite manifest can be improved: ${missingTags.join(', ')}.`;
  } else {
    /* ---------------------------- KIND 1 NOTES ------------------------------- */
    const bare = isBareUrlNote(pub.content);
    const audioMatch = pub.content.match(AUDIO_URL_RE) || pub.content.match(MUSIC_DOMAIN_RE);
    const imageMatch = pub.content.match(IMAGE_URL_RE);
    const blossomMatch = pub.content.match(BLOSSOM_SHA_URL_RE);
    const hasImeta = imetas.length > 0;
    const hasTags = pub.hashtags.length > 0;
    if (audioMatch) {
      score = 35;
      missingTags.push('upgrade from Kind 1 link → Kind 36787 music track', 'imeta', 'artist', 'image', 't');
      recommendedRelays = mergeRelays(healthyWriteRelays, ECOSYSTEM_DISCOVERY_RELAYS.music, 5);
      suggestedHashtags = inferTagsFromText(pub.content, pub.hashtags, ['nostrmusic', 'music']);
      diagnosis = 'Audio link posted as a plain Kind 1 note — music clients (Amethyst, Gruuv, Wavlake, Zapstr) do not index Kind 1 links as streamable releases.';
      clientCompatibility.push(
        {
          clientName: 'Amethyst · Gruuv · Wavlake (Music)',
          status: 'invisible',
          reason: 'Plain Kind 1 text link; not indexed in Nostr music catalogs.',
        },
        {
          clientName: 'Damus · Primal (Social)',
          status: 'partial',
          reason: 'Shows as a raw link in timeline only; disappears quickly from feeds.',
        }
      );
      prefillDraft = {
        label: 'Upgrade audio note to Kind 36787 Music Track',
        rationale: 'Promotes your Kind 1 audio link into a permanent, addressable Kind 36787 track indexed by Nostr music apps.',
        category: 'music',
        musicKindPreference: 36787,
        title: pub.title.replace(/https?:\/\/\S+/g, '').trim() || 'Untitled Track',
        summary: pub.content.replace(/https?:\/\/\S+/g, '').trim() || 'Music release on Nostr',
        content: pub.content,
        artist: authorName || undefined,
        license: preferredLicense || 'CC BY-SA 4.0',
        hashtags: Array.from(new Set([...pub.hashtags, ...suggestedHashtags])),
        externalAudioUrl: audioMatch[0],
        recommendedRelays,
        sourcePublicationId: pub.id,
      };
    } else if (bare.isBare && (imageMatch || blossomMatch || pub.assets.length > 0)) {
      score = 32;
      missingTags.push('caption / context', 'upgrade to NIP-68 Kind 20', 'imeta (dimensions + alt)', 't (topic hashtags)');
      recommendedRelays = mergeRelays(healthyWriteRelays, ECOSYSTEM_DISCOVERY_RELAYS.photos, 4);
      suggestedHashtags = ['photography', 'art', 'nostr'];
      diagnosis = 'Bare media URL posted as Kind 1 with zero caption, zero imeta/alt text, and zero hashtags — invisible to Olas and unsearchable in topic feeds.';
      clientCompatibility.push(
        {
          clientName: 'Olas · Primal Pictures (Kind 20)',
          status: 'invisible',
          reason: 'Picture-first clients filter for NIP-68 Kind 20 and skip bare Kind 1 media URLs.',
        },
        {
          clientName: 'Damus · Primal (Social)',
          status: 'partial',
          reason: 'May auto-preview URL, but no alt text, no dimensions (layout shift), and no topic discovery.',
        }
      );
      prefillDraft = {
        label: 'Upgrade bare media URL to NIP-68 Kind 20 Photo',
        rationale: 'Converts a bare Kind 1 Blossom/media link into a proper NIP-68 Kind 20 picture publication with imeta, alt text, and hashtags.',
        category: 'photo',
        title: '',
        summary: '',
        content: '',
        hashtags: suggestedHashtags,
        externalImageUrl: bare.url || imageMatch?.[0] || pub.assets[0]?.urls[0],
        externalAlt: '',
        recommendedRelays,
        sourcePublicationId: pub.id,
      };
    } else if (bare.isBare) {
      score = 45;
      missingTags.push('human caption explaining the link', 't (topic hashtags)');
      suggestedHashtags = inferTagsFromText(pub.content, pub.hashtags, ['nostr']);
      diagnosis = 'Bare link posted with no caption or hashtags — readers in timeline feeds have no context for why to click.';
      clientCompatibility.push({
        clientName: 'Damus · Primal · Coracle',
        status: 'partial',
        reason: 'Bare URL without context or #hashtags gets minimal engagement and zero topic-feed reach.',
      });
    } else {
      if ((imageMatch || blossomMatch) && !hasImeta) {
        missingTags.push('imeta (NIP-92 media dimensions & hash)');
        score -= 18;
      }
      if (!hasTags && pub.content.length > 40) {
        missingTags.push('t (1–3 topic hashtags for discovery)');
        score -= 14;
      }
      suggestedHashtags = inferTagsFromText(pub.content, pub.hashtags, []);
      clientCompatibility.push({
        clientName: 'Damus · Primal · Coracle',
        status: score >= 80 ? 'ready' : 'partial',
        reason: missingTags.length === 0
          ? 'Clean short note formatting.'
          : `Can improve reach with ${missingTags.join(', ')}.`,
      });
      diagnosis =
        missingTags.length === 0
          ? 'Cleanly formatted Kind 1 note.'
          : `Note can reach wider feeds by adding ${missingTags.join(', ')}.`;
    }
  }

  const finalScore = clampScore(score);
  return {
    publicationId: pub.id,
    title: pub.title,
    category: pub.category,
    kind: pub.kind,
    formatScore: finalScore,
    status: finalScore >= 82 ? 'optimized' : finalScore >= 55 ? 'needs-tuning' : 'under-formatted',
    diagnosis,
    missingTags,
    suggestedHashtags,
    recommendedRelays,
    clientCompatibility,
    prefillDraft,
  };
}
