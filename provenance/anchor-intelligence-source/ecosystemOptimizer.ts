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

import { ECOSYSTEM_DISCOVERY_RELAYS } from './nipRegistry';
import { buildRelayOptimizationPlan } from './relayIntelligence';
import type {
  AccountProfileLike,
  BlossomEndpoint,
  ClientCompatibilityStatus,
  ClientFitEntry,
  EcosystemOptimizationReport,
  EcosystemPublicationInput,
  OptimizationDraftPrefill,
  OptimizationRecommendation,
  PublicationOptimizationAudit,
  RelayPreference,
} from './types';

const AUDIO_URL_RE = /https:\/\/[^\s"'<>()]+\.(?:mp3|flac|wav|ogg|m4a|opus)(?:[?#][^\s"'<>()]*)?/i;
const IMAGE_URL_RE = /https:\/\/[^\s"'<>()]+\.(?:png|jpe?g|webp|gif|avif)(?:[?#][^\s"'<>()]*)?/i;
const BLOSSOM_SHA_URL_RE = /https:\/\/[^\s"'<>()]+?\/([0-9a-f]{64})(?:\.([a-z0-9]{2,5}))?(?=$|[\s"'<>()?#])/i;
const MUSIC_DOMAIN_RE = /https:\/\/(?:www\.)?(?:wavlake\.com|soundcloud\.com|bandcamp\.com|zapstr\.live|tunestr\.io|open\.spotify\.com|music\.apple\.com)\/[^\s"'<>()]+/i;
const MUSIC_SIGNAL_RE = /\b(music|track|song|album|single|ep|beat|beats|synth|audio|remix|player|playlist|soundtrack|mixtape|vocals|lofi|ambient|chao?music)\b/i;
const GAME_NSITE_RE = /\b(2048|game|survivor|arcade|puzzle|tetris|chess|pong|snake|clicker|zip\s*diff|diff)\b/i;
const SFX_PATH_RE = /(?:^|\/)(?:sfx|sound|sounds|fx|beep|click|pop|move|win|lose|hit|jump|merge|gameover|coin|ui)[-_a-z0-9]*\.(?:mp3|wav|ogg|m4a|opus)$/i;

function isLikelyMusicNsite(
  pub: EcosystemPublicationInput,
  audioPaths: EcosystemPublicationInput['assets']
): boolean {
  const dTag = getTagValue(pub.tags, 'd') || pub.dTag || '';
  const identityText = `${pub.title} ${dTag}`;
  if (GAME_NSITE_RE.test(identityText)) return false;

  const musicAudioPaths = audioPaths.filter(
    (a) => !SFX_PATH_RE.test(a.path || a.name)
  );
  const hasMusicIdentity = MUSIC_SIGNAL_RE.test(`${pub.title} ${dTag} ${pub.summary}`);
  if (hasMusicIdentity) return true;
  if (musicAudioPaths.length >= 2) return true;
  return (
    musicAudioPaths.length === 1 &&
    /(track|song|music|album|audio|mix)/i.test(musicAudioPaths[0].path || musicAudioPaths[0].name)
  );
}

const KEYWORD_TAG_RULES: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /\b(synth|synthesizer|modular|juno|analog)\b/i, tag: 'synth' },
  { pattern: /\b(ambient|drone|soundscape|rain|field\s*recording)\b/i, tag: 'ambient' },
  { pattern: /\b(electronic|edm|techno|house|electro|cyber|glitch|chaos)\b/i, tag: 'electronic' },
  { pattern: /\b(lofi|lo-fi|chillhop|chill)\b/i, tag: 'lofi' },
  { pattern: /\b(rock|guitar|punk|metal|grunge)\b/i, tag: 'rock' },
  { pattern: /\b(hip\s*hop|rap|beats|boom\s*bap)\b/i, tag: 'hiphop' },
  { pattern: /\b(indie|acoustic|folk|singer)\b/i, tag: 'indie' },
  { pattern: /\b(ai|suno|udio|generative)\b/i, tag: 'aimusic' },
  { pattern: /\b(game|2048|arcade|pixel|moji|survivor)\b/i, tag: 'gaming' },
  { pattern: /\b(nsite|blossom|nostr|relay|nip-\d+)\b/i, tag: 'nostr' },
  { pattern: /\b(art|photo|photography|camera|portrait|sunset|street)\b/i, tag: 'photography' },
  { pattern: /\b(code|dev|typescript|javascript|app|tool|diff|zip)\b/i, tag: 'nostrdev' },
  { pattern: /\b(bitcoin|lightning|zap|v4v|sats)\b/i, tag: 'v4v' },
];

function slugifyShort(value: string, maxLen = 28): string {
  const clean = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (clean || 'release').slice(0, maxLen).replace(/-+$/, '');
}

function getTagValue(tags: string[][], key: string): string | undefined {
  return tags.find((t) => t[0] === key && typeof t[1] === 'string' && t[1].trim().length > 0)?.[1]?.trim();
}

function getImetaFields(tags: string[][]): Array<Record<string, string>> {
  return tags
    .filter((t) => t[0] === 'imeta')
    .map((tag) => {
      const record: Record<string, string> = {};
      for (const item of tag.slice(1)) {
        const sp = item.indexOf(' ');
        if (sp === -1) continue;
        const k = item.slice(0, sp).trim();
        const v = item.slice(sp + 1).trim();
        if (k && v) record[k] = v;
      }
      return record;
    });
}

function inferTagsFromText(text: string, existing: string[], defaults: string[]): string[] {
  const existingSet = new Set(existing.map((t) => t.toLowerCase()));
  const suggested: string[] = [];

  for (const tag of defaults) {
    if (!existingSet.has(tag)) {
      suggested.push(tag);
      existingSet.add(tag);
    }
  }
  for (const rule of KEYWORD_TAG_RULES) {
    if (rule.pattern.test(text) && !existingSet.has(rule.tag)) {
      suggested.push(rule.tag);
      existingSet.add(rule.tag);
    }
    if (suggested.length >= 5) break;
  }
  return suggested;
}

function isBareUrlNote(content: string): { isBare: boolean; url?: string; sha256?: string; ext?: string } {
  const trimmed = content.trim();
  if (!trimmed || trimmed.includes('\n')) {
    // Allow single-URL line with optional whitespace only
    const lines = trimmed.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length !== 1) return { isBare: false };
  }
  const single = trimmed.replace(/\s+/g, ' ');
  if (/^https:\/\/\S+$/i.test(single)) {
    const blossom = single.match(BLOSSOM_SHA_URL_RE);
    return {
      isBare: true,
      url: single,
      sha256: blossom?.[1]?.toLowerCase(),
      ext: blossom?.[2]?.toLowerCase(),
    };
  }
  return { isBare: false };
}

function mergeRelays(primary: string[], extra: readonly string[], limit = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (url: string) => {
    const clean = url.trim().replace(/\/$/, '');
    if (!clean.startsWith('wss://') || seen.has(clean) || out.length >= limit) return;
    seen.add(clean);
    out.push(clean);
  };

  const generalSet = new Set<string>(ECOSYSTEM_DISCOVERY_RELAYS.generalOutbox);
  const specialty = extra.filter((r) => !generalSet.has(r));
  const reservedPrimaryCount = Math.max(1, limit - specialty.length);

  for (const r of primary.slice(0, reservedPrimaryCount)) add(r);
  for (const r of specialty) add(r);
  for (const r of extra) add(r);
  for (const r of primary) add(r);
  return out;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Audit a single publication against Nostr ecosystem client specs.
 */
export function auditSinglePublication(params: {
  pub: EcosystemPublicationInput;
  profile: AccountProfileLike;
  healthyWriteRelays: string[];
  preferredLicense?: string;
}): PublicationOptimizationAudit {
  const { pub, profile, healthyWriteRelays, preferredLicense } = params;
  const authorName = profile.display_name || profile.name || pub.artist || '';
  const imetas = getImetaFields(pub.tags);
  const missingTags: string[] = [];
  const clientCompatibility: PublicationOptimizationAudit['clientCompatibility'] = [];
  let score = 100;
  let diagnosis = 'Formatted cleanly for ecosystem clients.';
  let prefillDraft: OptimizationDraftPrefill | undefined;
  let recommendedRelays = mergeRelays(healthyWriteRelays, ECOSYSTEM_DISCOVERY_RELAYS.generalOutbox, 4);
  let suggestedHashtags: string[] = [];

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
    const hasZap = pub.tags.some((t) => t[0] === 'zap' && t[1]);
    const hasGenreTags = pub.hashtags.length > 0;

    if (pub.kind !== 36787) {
      missingTags.push('kind:36787 (modern NIP-Music track)');
      score -= 18;
    }
    if (!hasD) { missingTags.push('d (track slug)'); score -= 12; }
    if (!hasTitle) { missingTags.push('title'); score -= 14; }
    if (!hasArtist) { missingTags.push('artist'); score -= 12; }
    if (!directUrl) { missingTags.push('url (direct Blossom audio stream)'); score -= 22; }
    if (!hasImeta) { missingTags.push('imeta (url, m, x, size)'); score -= 10; }
    if (!hasImage) { missingTags.push('image (cover artwork)'); score -= 12; }
    if (!hasDuration) { missingTags.push('duration (seconds)'); score -= 6; }
    if (!hasGenreTags) { missingTags.push('t (genre & #nostrmusic hashtags)'); score -= 10; }
    if (!hasLicense) { missingTags.push('license'); score -= 5; }
    if (!hasZap && !profile.lud16) { missingTags.push('zap / lud16 (V4V splits)'); score -= 6; }

    suggestedHashtags = inferTagsFromText(
      `${pub.title} ${pub.summary} ${pub.content}`,
      pub.hashtags,
      ['nostrmusic', 'music']
    );

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

    if (!hasD) { missingTags.push('d (stable article slug)'); score -= 20; }
    if (!hasTitle) { missingTags.push('title'); score -= 20; }
    if (!hasSummary) { missingTags.push('summary (feed preview excerpt)'); score -= 18; }
    if (!hasImage) { missingTags.push('image (header cover banner)'); score -= 18; }
    if (!hasPublishedAt) { missingTags.push('published_at (original timestamp)'); score -= 10; }
    if (!hasTags) { missingTags.push('t (topic hashtags)'); score -= 14; }

    suggestedHashtags = inferTagsFromText(
      `${pub.title} ${pub.summary} ${pub.content}`,
      pub.hashtags,
      ['nostr']
    );

    clientCompatibility.push({
      clientName: 'Yakihonne · Habla · Highlighter',
      status: score >= 85 ? 'ready' : score >= 55 ? 'partial' : 'invisible',
      reason:
        missingTags.length === 0
          ? 'Full NIP-23 card metadata (title, summary, banner image, published_at, tags).'
          : `Renders without ${missingTags.slice(0, 3).join(', ')}, reducing click-through in reader feeds.`,
    });

    diagnosis =
      missingTags.length === 0
        ? 'Complete NIP-23 long-form article metadata.'
        : `Article is missing ${missingTags.join(', ')} needed for rich cards on Yakihonne and Habla.`;

    if (score < 95) {
      const cleanSummary =
        getTagValue(pub.tags, 'summary') ||
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

    if (!hasImetaUrl) { missingTags.push('imeta url'); score -= 35; }
    if (!hasMime) { missingTags.push('imeta m (MIME)'); score -= 10; }
    if (!hasHash) { missingTags.push('imeta x (SHA-256)'); score -= 10; }
    if (!hasAlt) { missingTags.push('alt (image description)'); score -= 18; }
    if (!hasRealTitle) { missingTags.push('title (human-readable caption)'); score -= 15; }
    if (!hasTags) { missingTags.push('t (topic hashtags)'); score -= 12; }

    suggestedHashtags = inferTagsFromText(
      `${pub.title} ${pub.content}`,
      pub.hashtags,
      ['photography', 'art']
    );

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
    const pathTags = pub.tags.filter((t) => t[0] === 'path' && t[1] && t[2]);
    const hasIndexHtml =
      pathTags.some((t) => /^\/?index\.html?$/i.test(t[1])) ||
      pub.assets.some((a) => /^\/?index\.html?$/i.test(a.path || a.name));
    const hasTitle = Boolean(getTagValue(pub.tags, 'title'));
    const hasDescription = Boolean(getTagValue(pub.tags, 'description'));
    const hasServerHint = pub.tags.some((t) => t[0] === 'server' && t[1]?.startsWith('https://'));
    const dTag = getTagValue(pub.tags, 'd') || pub.dTag || '';
    const dTooLong = pub.kind === 35128 && dTag.length > 13;

    // Check if this nsite is actually hosting a music player / audio tracks without native Kind 36787 tracks
    const audioPaths = pub.assets.filter(
      (a) => a.mimeType.startsWith('audio/') || /\.(mp3|flac|wav|ogg|m4a|opus)$/i.test(a.path || a.name)
    );
    const looksLikeMusicSite = isLikelyMusicNsite(pub, audioPaths);

    if (pub.kind === 34128) { missingTags.push('migrate Kind 34128 → Kind 15128'); score -= 25; }
    if (!hasIndexHtml) { missingTags.push('/index.html entry path'); score -= 25; }
    if (!hasTitle) { missingTags.push('title'); score -= 12; }
    if (!hasDescription) { missingTags.push('description'); score -= 10; }
    if (!hasServerHint) { missingTags.push('server (Blossom fallback hints)'); score -= 8; }
    if (dTooLong) { missingTags.push('d slug <= 13 chars for subdomain routing'); score -= 15; }
    if (looksLikeMusicSite) {
      missingTags.push('companion Kind 36787 track events for Nostr music clients');
      score -= 15;
    }

    clientCompatibility.push({
      clientName: 'Nsite Gateways (nsite.lol)',
      status: hasIndexHtml && !dTooLong && pub.kind !== 34128 ? 'ready' : 'partial',
      reason:
        hasIndexHtml && !dTooLong && pub.kind !== 34128
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
        (a) =>
          a.mimeType.startsWith('image/') &&
          /(cover|art|thumb|poster|album)/i.test(a.path || a.name)
      );
      suggestedHashtags = inferTagsFromText(
        `${pub.title} ${pub.summary} ${dTag}`,
        pub.hashtags,
        ['nostrmusic', 'music', 'v4v']
      );
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
        reason:
          missingTags.length === 0
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

/**
 * Full Account Ecosystem Architecture & Optimization Brain.
 * Evaluates where the user fits, what is holding back visibility, and produces concrete
 * format + tag + broadcast upgrades across Music, Articles, Photos, Nsites, and Outbox infrastructure.
 */
export function analyzeAccountEcosystem(params: {
  profile: AccountProfileLike;
  relays: RelayPreference[];
  blossomServers: BlossomEndpoint[];
  publications: EcosystemPublicationInput[];
  preferredLicense?: string;
}): EcosystemOptimizationReport {
  const { profile, relays, blossomServers, preferredLicense } = params;
  const activePubs = params.publications.filter((p) => !p.deleted);
  const authorName = profile.display_name || profile.name || 'Creator';

  // 1. Outbox, Relay Fitness & Blossom infrastructure analysis (never assume current relays are right!)
  const hasAnyMusicHint =
    activePubs.some(
      (p) =>
        p.kind === 36787 ||
        p.kind === 31337 ||
        p.kind === 32123 ||
        p.category === 'music'
    ) || MUSIC_SIGNAL_RE.test(profile.about || '');
  const hasAnyArticleHint = activePubs.some((p) => p.kind === 30023);

  const relayPlan = buildRelayOptimizationPlan({
    currentRelays: relays,
    hasMusic: hasAnyMusicHint,
    hasArticles: hasAnyArticleHint,
  });

  const writeRelays = relays.filter((r) => r.write);
  const degradedWriteRelays = relayPlan.auditedRelays
    .filter((r) => r.write && r.roleClass === 'dead-or-redirect')
    .map((r) => r.url);
  const mismatchedWriteRelays = relayPlan.relaysToDropOrDemote
    .filter((r) => r.roleClass !== 'dead-or-redirect')
    .map((r) => r.url);
  const cleanPublicWriteRelays = relayPlan.auditedRelays
    .filter(
      (r) =>
        r.write &&
        (r.roleClass === 'general-outbox' || r.roleClass === 'community-niche')
    )
    .map((r) => r.url);
  const healthyWriteRelays = relayPlan.recommendedWriteRelays;

  const recommendedWriteRelays = relayPlan.recommendedWriteRelays;

  let outboxScore = 100;
  const outboxIssues: string[] = [];
  if (writeRelays.length === 0) {
    outboxScore -= 55;
    outboxIssues.push('No NIP-65 write relays configured (Kind 10002).');
  } else if (writeRelays.length > 5) {
    outboxScore -= 18;
    outboxIssues.push(
      `${writeRelays.length} write relays advertised — NIP-65 outbox works best with 3–5 fast public relays.`
    );
  }
  if (degradedWriteRelays.length > 0) {
    outboxScore -= Math.min(30, degradedWriteRelays.length * 14);
    outboxIssues.push(
      `${degradedWriteRelays.length} write relay${degradedWriteRelays.length === 1 ? '' : 's'} unreachable or redirecting (${degradedWriteRelays.slice(0, 2).join(', ')}).`
    );
  }
  if (mismatchedWriteRelays.length > 0) {
    outboxScore -= Math.min(28, mismatchedWriteRelays.length * 10);
    const mismatchLabels = relayPlan.relaysToDropOrDemote
      .filter((r) => r.roleClass !== 'dead-or-redirect')
      .slice(0, 3)
      .map((r) => `${r.url.replace(/^wss:\/\//, '')} (${r.roleLabel})`)
      .join(', ');
    outboxIssues.push(
      `${mismatchedWriteRelays.length} write relay${mismatchedWriteRelays.length === 1 ? ' is' : 's are'} non-outbox (${mismatchLabels}) — wrong fit for public music/article/photo discovery.`
    );
  }
  const hasMajorDiscoveryRelay = relayPlan.auditedRelays.some(
    (r) => r.write && r.roleClass === 'general-outbox'
  );
  if (!hasMajorDiscoveryRelay) {
    outboxScore -= 18;
    outboxIssues.push(
      'None of your write relays are high-reach public discovery relays (damus / nos.lol / primal) — clients outside your niche relays may miss releases.'
    );
  }

  let storageScore = 100;
  if (blossomServers.length === 0) {
    storageScore = 40;
  } else if (blossomServers.length > 5) {
    storageScore -= 26;
  }
  const allAssets = activePubs.flatMap((p) => p.assets);
  if (allAssets.length > 0 && blossomServers.length > 0) {
    const avgRatio =
      allAssets.reduce((sum, a) => sum + Math.min(1, a.storedOnServers.length / Math.min(blossomServers.length, 3)), 0) /
      allAssets.length;
    storageScore = clampScore(storageScore * 0.45 + avgRatio * 100 * 0.55);
  }

  // 2. Per-publication audits
  const publicationAudits: Record<string, PublicationOptimizationAudit> = {};
  for (const pub of activePubs) {
    publicationAudits[pub.id] = auditSinglePublication({
      pub,
      profile,
      healthyWriteRelays,
      preferredLicense,
    });
  }

  // 3. Music ecosystem deep inspection (native tracks + trapped music in nsites / Kind 1 notes)
  const nativeMusicPubs = activePubs.filter(
    (p) => p.kind === 36787 || p.kind === 31337 || p.kind === 32123 || p.category === 'music'
  );
  const kind36787Count = nativeMusicPubs.filter((p) => p.kind === 36787).length;
  const kind31337Count = nativeMusicPubs.filter((p) => p.kind === 31337).length;
  const kindOtherCount = nativeMusicPubs.length - kind36787Count - kind31337Count;

  const trappedMusicSources: EcosystemOptimizationReport['musicSpotlight']['trappedMusicSources'] = [];
  for (const pub of activePubs) {
    if (pub.kind === 36787 || pub.kind === 31337 || pub.kind === 32123) continue;
    const isNsite = pub.kind === 15128 || pub.kind === 35128 || pub.kind === 34128;
    const audioAssets = pub.assets.filter(
      (a) => a.mimeType.startsWith('audio/') || /\.(mp3|flac|wav|ogg|m4a|opus)$/i.test(a.path || a.name)
    );
    const hasAudioLink = AUDIO_URL_RE.test(pub.content) || MUSIC_DOMAIN_RE.test(pub.content);

    if (isNsite && isLikelyMusicNsite(pub, audioAssets)) {
      trappedMusicSources.push({
        publicationId: pub.id,
        title: pub.title,
        kind: pub.kind,
        reason: `Hosted as a Kind ${pub.kind} web nsite (d="${pub.dTag || 'root'}"). Web gateways render it, but Amethyst, Gruuv, Wavlake, and Zapstr cannot index songs inside an nsite without standalone Kind 36787 track events.`,
      });
    } else if (pub.kind === 1 && (hasAudioLink || audioAssets.length > 0)) {
      trappedMusicSources.push({
        publicationId: pub.id,
        title: pub.title,
        kind: pub.kind,
        reason: 'Posted as a plain Kind 1 link note — invisible to Nostr music players and genre feeds.',
      });
    }
  }

  const hasMusicSignals = nativeMusicPubs.length > 0 || trappedMusicSources.length > 0 || MUSIC_SIGNAL_RE.test(profile.about || '');
  const musicMissingFields = new Set<string>();
  if (kind36787Count === 0) musicMissingFields.add('Kind 36787 track events (Amethyst / Gruuv / Wisp)');
  if (!profile.lud16) musicMissingFields.add('Kind 0 lud16 Lightning Address (V4V zaps)');
  if (!writeRelays.some((r) => r.url.includes('wavlake'))) {
    musicMissingFields.add('Music relay broadcast (wss://relay.wavlake.com)');
  }

  // Aggregate exact missing-tag counts across every real native music track
  const gapCounter = new Map<string, number>();
  const auditedNativeTracks = nativeMusicPubs
    .map((track) => ({ track, audit: publicationAudits[track.id] }))
    .filter((entry): entry is { track: EcosystemPublicationInput; audit: PublicationOptimizationAudit } =>
      Boolean(entry.audit)
    )
    .sort((a, b) => a.audit.formatScore - b.audit.formatScore);

  for (const { audit } of auditedNativeTracks) {
    for (const m of audit.missingTags) {
      musicMissingFields.add(m);
      gapCounter.set(m, (gapCounter.get(m) || 0) + 1);
    }
  }

  const catalogGaps = Array.from(gapCounter.entries())
    .map(([field, missingCount]) => ({
      field,
      missingCount,
      totalCount: nativeMusicPubs.length,
    }))
    .sort((a, b) => b.missingCount - a.missingCount)
    .slice(0, 6);

  const allUnderFormattedTracks = auditedNativeTracks.filter((e) => e.audit.formatScore < 92);
  const underFormattedTracks = allUnderFormattedTracks.slice(0, 4).map(({ track, audit }) => ({
    publicationId: track.id,
    title: track.title,
    kind: track.kind,
    formatScore: audit.formatScore,
    missingTags: audit.missingTags,
    prefillDraft: audit.prefillDraft,
  }));

  const primaryMusicSource = underFormattedTracks[0]?.prefillDraft
    ? underFormattedTracks[0].prefillDraft
    : trappedMusicSources[0]
      ? publicationAudits[trappedMusicSources[0].publicationId]?.prefillDraft
      : nativeMusicPubs[0]
        ? publicationAudits[nativeMusicPubs[0].id]?.prefillDraft
        : undefined;

  const musicPrefillDraft: OptimizationDraftPrefill = primaryMusicSource || {
    label: 'Prepare Kind 36787 music release',
    rationale: 'Creates a fully compliant Kind 36787 music track with Blossom audio, cover art, artist attribution, genre #t tags, license, V4V zap split, and music discovery relays.',
    category: 'music',
    musicKindPreference: 36787,
    title: '',
    summary: '',
    content: '',
    artist: profile.display_name || profile.name || undefined,
    license: preferredLicense || 'CC BY-SA 4.0',
    hashtags: ['nostrmusic', 'music', 'v4v'],
    recommendedRelays: mergeRelays(healthyWriteRelays, ECOSYSTEM_DISCOVERY_RELAYS.music, 5),
  };

  // 4. Category counts & messy-output counts
  const articlePubs = activePubs.filter((p) => p.kind === 30023);
  const photoPubs = activePubs.filter((p) => p.kind === 20);
  const nsitePubs = activePubs.filter((p) => p.kind === 15128 || p.kind === 35128 || p.kind === 34128);
  const bareUrlKind1Pubs = activePubs.filter(
    (p) => p.kind === 1 && isBareUrlNote(p.content).isBare
  );
  const bareMediaKind1Pubs = bareUrlKind1Pubs.filter(
    (p) => IMAGE_URL_RE.test(p.content) || BLOSSOM_SHA_URL_RE.test(p.content) || p.assets.length > 0
  );

  // 5. Client Compatibility Matrix ("Where You Fit")
  const clientMatrix: ClientFitEntry[] = [];

  // Music: Amethyst / Gruuv / Wisp
  const amethystStatus: ClientCompatibilityStatus =
    kind36787Count > 0 && nativeMusicPubs.every((p) => (publicationAudits[p.id]?.formatScore ?? 0) >= 82)
      ? 'ready'
      : nativeMusicPubs.length > 0
        ? 'partial'
        : 'invisible';
  clientMatrix.push({
    clientId: 'amethyst-gruuv-music',
    clientName: 'Amethyst · Gruuv · Wisp (Music)',
    category: 'music',
    supportedKinds: [36787],
    status: amethystStatus,
    headline:
      amethystStatus === 'ready'
        ? `${kind36787Count} streamable Kind 36787 track${kind36787Count === 1 ? '' : 's'} indexed`
        : trappedMusicSources.length > 0
          ? `${trappedMusicSources.length} music source${trappedMusicSources.length === 1 ? '' : 's'} trapped outside Kind 36787`
          : nativeMusicPubs.length > 0
            ? `${nativeMusicPubs.length} track${nativeMusicPubs.length === 1 ? '' : 's'} need Kind 36787 metadata polish`
            : 'No Kind 36787 music tracks published yet',
    reason:
      amethystStatus === 'ready'
        ? 'Tracks include direct Blossom audio, cover art, artist, and genre tags.'
        : trappedMusicSources.length > 0
          ? `Found music inside "${trappedMusicSources[0].title}" (Kind ${trappedMusicSources[0].kind}), which Nostr music apps cannot index until mirrored as Kind 36787 track events.`
          : 'Publish addressable Kind 36787 events with direct audio url, imeta, image, duration, and #nostrmusic tags.',
    missingRequirements: Array.from(musicMissingFields).slice(0, 4),
    recommendedRelays: [...ECOSYSTEM_DISCOVERY_RELAYS.music],
  });

  // Music: Wavlake / Fountain V4V
  const v4vReady = nativeMusicPubs.length > 0 && Boolean(profile.lud16);
  clientMatrix.push({
    clientId: 'wavlake-fountain-v4v',
    clientName: 'Wavlake · Zapstr · V4V Music',
    category: 'music',
    supportedKinds: [36787, 31337],
    status: v4vReady && kind36787Count > 0 ? 'partial' : nativeMusicPubs.length > 0 ? 'partial' : 'invisible',
    headline: profile.lud16
      ? nativeMusicPubs.length > 0
        ? 'Lightning Address present · add zap splits & music relay'
        : 'Lightning Address ready · needs Kind 36787/31337 tracks'
      : 'Missing Lightning Address (lud16) & music track events',
    reason: !profile.lud16
      ? 'Set lud16 on Kind 0 profile and include zap split tags on Kind 36787/31337 releases to unlock Value-for-Value music zaps.'
      : 'Add explicit zap split tags + broadcast tracks to wss://relay.wavlake.com alongside your write relays.',
    missingRequirements: [
      ...(profile.lud16 ? [] : ['Kind 0 lud16 Lightning Address']),
      ...(nativeMusicPubs.length === 0 ? ['Kind 36787 / 31337 track events'] : []),
      'zap split tag + wss://relay.wavlake.com',
    ],
    recommendedRelays: ['wss://relay.wavlake.com', 'wss://relay.damus.io', 'wss://nos.lol'],
  });

  // Articles: Yakihonne / Habla / Highlighter
  const articleAudits = articlePubs.map((p) => publicationAudits[p.id]).filter(Boolean);
  const avgArticleScore =
    articleAudits.length > 0
      ? Math.round(articleAudits.reduce((s, a) => s + a.formatScore, 0) / articleAudits.length)
      : 0;
  const articleStatus: ClientCompatibilityStatus =
    articlePubs.length === 0 ? 'invisible' : avgArticleScore >= 82 ? 'ready' : 'partial';
  clientMatrix.push({
    clientId: 'yakihonne-habla-articles',
    clientName: 'Yakihonne · Habla · Highlighter',
    category: 'article',
    supportedKinds: [30023],
    status: articleStatus,
    headline:
      articlePubs.length === 0
        ? 'No Kind 30023 long-form articles recovered'
        : `${articlePubs.length} article${articlePubs.length === 1 ? '' : 's'} · avg spec score ${avgArticleScore}/100`,
    reason:
      articlePubs.length === 0
        ? 'Publish essays, liner notes, or dev logs as NIP-23 Kind 30023 with summary, banner image, and #t tags.'
        : avgArticleScore >= 82
          ? 'Articles include solid NIP-23 metadata for long-form readers.'
          : 'Some articles are missing summary excerpts, banner images, published_at, or topic tags.',
    missingRequirements: Array.from(new Set(articleAudits.flatMap((a) => a.missingTags))).slice(0, 4),
    recommendedRelays: [...ECOSYSTEM_DISCOVERY_RELAYS.articles],
  });

  // Photos: Olas / Primal Pictures
  const photoAudits = photoPubs.map((p) => publicationAudits[p.id]).filter(Boolean);
  const avgPhotoScore =
    photoAudits.length > 0
      ? Math.round(photoAudits.reduce((s, a) => s + a.formatScore, 0) / photoAudits.length)
      : 0;
  const photoStatus: ClientCompatibilityStatus =
    photoPubs.length === 0
      ? 'invisible'
      : avgPhotoScore >= 82 && bareMediaKind1Pubs.length === 0
        ? 'ready'
        : 'partial';
  clientMatrix.push({
    clientId: 'olas-primal-photos',
    clientName: 'Olas · Primal · Amethyst Pictures',
    category: 'photo',
    supportedKinds: [20],
    status: photoStatus,
    headline:
      photoPubs.length > 0
        ? `${photoPubs.length} Kind 20 photo${photoPubs.length === 1 ? '' : 's'} · ${bareMediaKind1Pubs.length} bare media note${bareMediaKind1Pubs.length === 1 ? '' : 's'}`
        : bareMediaKind1Pubs.length > 0
          ? `${bareMediaKind1Pubs.length} bare media URLs posted as Kind 1 (skipped by Olas)`
          : 'No Kind 20 picture posts recovered',
    reason:
      bareMediaKind1Pubs.length > 0
        ? `Found ${bareMediaKind1Pubs.length} Kind 1 notes containing only a bare Blossom/media URL. Publishing visuals as NIP-68 Kind 20 with imeta + alt text unlocks Olas and visual discovery feeds.`
        : photoPubs.length > 0
          ? 'Add descriptive titles, alt text, and hashtags to Kind 20 photos so they surface cleanly.'
          : 'Use NIP-68 Kind 20 with imeta and alt text when sharing visual work.',
    missingRequirements: Array.from(
      new Set([
        ...photoAudits.flatMap((a) => a.missingTags),
        ...(bareMediaKind1Pubs.length > 0 ? ['Upgrade bare Kind 1 media links → Kind 20'] : []),
      ])
    ).slice(0, 4),
    recommendedRelays: [...ECOSYSTEM_DISCOVERY_RELAYS.photos],
  });

  // Nsites: nsite.lol Gateways
  const nsiteAudits = nsitePubs.map((p) => publicationAudits[p.id]).filter(Boolean);
  const nsiteStatus: ClientCompatibilityStatus =
    nsitePubs.length === 0
      ? 'invisible'
      : nsitePubs.some((p) => p.kind === 34128) || blossomServers.length === 0
        ? 'partial'
        : 'ready';
  clientMatrix.push({
    clientId: 'nsite-gateways',
    clientName: 'Nsite Gateways (nsite.lol)',
    category: 'nsite',
    supportedKinds: [15128, 35128],
    status: nsiteStatus,
    headline:
      nsitePubs.length > 0
        ? `${nsitePubs.length} static nsite${nsitePubs.length === 1 ? '' : 's'} active`
        : 'No static nsites published yet',
    reason:
      nsitePubs.length > 0
        ? `Gateways resolve your ${nsitePubs.length} nsite${nsitePubs.length === 1 ? '' : 's'} using your Kind 10002 write relays and Kind 10063 Blossom list.`
        : 'Publish static web apps, EPKs, or music players as Kind 15128 (root) or Kind 35128 (named) nsites.',
    missingRequirements: Array.from(new Set(nsiteAudits.flatMap((a) => a.missingTags))).slice(0, 3),
    recommendedRelays: [...ECOSYSTEM_DISCOVERY_RELAYS.nsites],
  });

  // 6. Prioritized Recommendations ("Format · Tag · Broadcast")
  const recommendations: OptimizationRecommendation[] = [];

  // Rec 1A: Under-formatted native music catalog (audit real audio tracks first!)
  if (allUnderFormattedTracks.length > 0) {
    const weakest = allUnderFormattedTracks[0];
    const topGapSummary = catalogGaps
      .slice(0, 3)
      .map((g) => `${g.missingCount}/${g.totalCount} missing ${g.field}`)
      .join('; ');
    const kindBreakdown = [
      kind36787Count > 0 ? `${kind36787Count} Kind 36787` : null,
      kind31337Count > 0 ? `${kind31337Count} Kind 31337` : null,
      kindOtherCount > 0 ? `${kindOtherCount} Kind 32123/other` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    recommendations.push({
      id: `rec-music-catalog-upgrade`,
      priority: 'high',
      area: 'music',
      title: `Optimize ${allUnderFormattedTracks.length} of ${nativeMusicPubs.length} music track${nativeMusicPubs.length === 1 ? '' : 's'} for music publishers`,
      diagnosis: `Recovered ${nativeMusicPubs.length} native audio events (${kindBreakdown}). ${topGapSummary ? `Catalog gaps: ${topGapSummary}.` : weakest.audit.diagnosis}`,
      whereYouFit: 'Amethyst, Gruuv, Wisp, Zapstr, and Wavlake rely on Kind 36787 with direct audio url, imeta, cover art, artist, duration, genre #t tags, and V4V zap splits.',
      howToFormat: `Re-publish under-formatted tracks (starting with "${weakest.track.title}") as Kind 36787 preserving each track's d-tag while filling: ${weakest.audit.missingTags.slice(0, 5).join(', ')}.`,
      whereToBroadcast: weakest.audit.recommendedRelays,
      tagsToAdd: [
        ['d', weakest.track.dTag || slugifyShort(weakest.track.title)],
        ['title', weakest.track.title],
        ['artist', weakest.track.artist || authorName],
        ['url', weakest.audit.prefillDraft?.externalAudioUrl || 'https://<your-blossom>/<audio-sha256>.mp3'],
        ['image', weakest.audit.prefillDraft?.externalCoverUrl || 'https://<your-blossom>/<cover-sha256>.jpg'],
        ['license', preferredLicense || 'CC BY-SA 4.0'],
        ...weakest.audit.suggestedHashtags.slice(0, 3).map((t) => ['t', t]),
      ],
      targetKind: 36787,
      sourcePublicationId: weakest.track.id,
      sourceTitle: weakest.track.title,
      prefillDraft: weakest.audit.prefillDraft,
    });
  }

  // Rec 1B: Trapped Music inside a web nsite or Kind 1 link (independent from native catalog!)
  if (trappedMusicSources.length > 0) {
    const first = trappedMusicSources[0];
    const trappedPrefill = publicationAudits[first.publicationId]?.prefillDraft || musicPrefillDraft;
    recommendations.push({
      id: `rec-music-trapped-${first.publicationId}`,
      priority: allUnderFormattedTracks.length > 0 ? 'medium' : 'high',
      area: 'music',
      title: `Publish standalone Kind 36787 tracks for "${first.title}"`,
      diagnosis: first.reason,
      whereYouFit: 'Amethyst, Gruuv, Wisp, Zapstr, and Wavlake index addressable Kind 36787 (and Kind 31337) music events — not HTML web players or Kind 1 links.',
      howToFormat: 'Sign one Kind 36787 event per song pointing at your Blossom SHA-256 audio file, paired with square cover artwork, duration, license, V4V zap split, and genre #t tags.',
      whereToBroadcast: mergeRelays(healthyWriteRelays, ECOSYSTEM_DISCOVERY_RELAYS.music, 5),
      tagsToAdd: [
        ['d', slugifyShort(first.title, 24)],
        ['title', first.title.replace(/\s*[·\-–|]\s*music\s*player.*$/i, '').trim()],
        ['artist', authorName],
        ['url', trappedPrefill.externalAudioUrl || 'https://<your-blossom>/<audio-sha256>.mp3'],
        ['imeta', `url ${trappedPrefill.externalAudioUrl || 'https://<your-blossom>/<audio-sha256>.mp3'}`, 'm audio/mpeg', 'x <audio-sha256>'],
        ['image', trappedPrefill.externalCoverUrl || 'https://<your-blossom>/<cover-sha256>.jpg'],
        ['t', 'nostrmusic'],
        ['t', 'music'],
        ['license', preferredLicense || 'CC BY-SA 4.0'],
      ],
      targetKind: 36787,
      sourcePublicationId: first.publicationId,
      sourceTitle: first.title,
      prefillDraft: trappedPrefill,
    });
  }

  // Rec 2: Bare-URL Kind 1 media notes → Upgrade to NIP-68 Kind 20
  if (bareMediaKind1Pubs.length > 0) {
    const sample = bareMediaKind1Pubs[0];
    const sampleAudit = publicationAudits[sample.id];
    recommendations.push({
      id: 'rec-bare-media-kind20',
      priority: 'high',
      area: 'photos',
      title: `Upgrade ${bareMediaKind1Pubs.length} bare-URL media note${bareMediaKind1Pubs.length === 1 ? '' : 's'} to NIP-68 Kind 20`,
      diagnosis: `${bareMediaKind1Pubs.length} Kind 1 post${bareMediaKind1Pubs.length === 1 ? ' is' : 's are'} just a raw Blossom/media URL with no caption, no imeta, no alt text, and no hashtags.`,
      whereYouFit: 'Olas, Primal Pictures, and Amethyst visual feeds specifically query Kind 20 with imeta + alt text and skip bare Kind 1 URL drops.',
      howToFormat: 'Publish visual drops as Kind 20 with imeta (url, m, x, dim, alt), a concise title, and 2–3 topic #t tags.',
      whereToBroadcast: mergeRelays(healthyWriteRelays, ECOSYSTEM_DISCOVERY_RELAYS.photos, 4),
      tagsToAdd: [
        ['title', 'Descriptive title'],
        ['imeta', `url ${sampleAudit?.prefillDraft?.externalImageUrl || 'https://<blossom>/<sha256>'}`, 'm image/jpeg', 'alt <accessible description>'],
        ['t', 'photography'],
        ['t', 'art'],
      ],
      targetKind: 20,
      sourcePublicationId: sample.id,
      sourceTitle: sample.title,
      prefillDraft: sampleAudit?.prefillDraft,
    });
  }

  // Rec 3: Under-formatted Kind 20 photos (e.g. missing title / alt / tags)
  const weakPhotos = photoPubs.filter((p) => (publicationAudits[p.id]?.formatScore ?? 100) < 82);
  if (weakPhotos.length > 0) {
    const sample = weakPhotos[0];
    const audit = publicationAudits[sample.id];
    recommendations.push({
      id: `rec-photo-polish-${sample.id}`,
      priority: 'medium',
      area: 'photos',
      title: `Add title, alt text & tags to ${weakPhotos.length} Kind 20 photo${weakPhotos.length === 1 ? '' : 's'}`,
      diagnosis: audit.diagnosis,
      whereYouFit: 'Olas and Primal photo feeds rely on title, imeta alt text, and #t tags for captions, accessibility, and search.',
      howToFormat: 'Include human-readable title, imeta alt description, and 2–4 #t topic tags.',
      whereToBroadcast: audit.recommendedRelays,
      tagsToAdd: [
        ['title', 'Concise caption'],
        ['alt', 'Visual description for screen readers & search'],
        ...audit.suggestedHashtags.slice(0, 3).map((t) => ['t', t]),
      ],
      targetKind: 20,
      sourcePublicationId: sample.id,
      sourceTitle: sample.title,
      prefillDraft: audit.prefillDraft,
    });
  }

  // Rec 4: Long-Form Articles (Kind 30023)
  const weakArticles = articlePubs.filter((p) => (publicationAudits[p.id]?.formatScore ?? 100) < 85);
  if (weakArticles.length > 0) {
    const sample = weakArticles[0];
    const audit = publicationAudits[sample.id];
    recommendations.push({
      id: `rec-article-polish-${sample.id}`,
      priority: 'medium',
      area: 'articles',
      title: `Complete NIP-23 reader cards for "${sample.title}"`,
      diagnosis: audit.diagnosis,
      whereYouFit: 'Yakihonne, Habla, and Highlighter display Kind 30023 articles as rich cards using summary, header image, published_at, and #t tags.',
      howToFormat: `Publish a revision preserving d="${sample.dTag || slugifyShort(sample.title)}" with missing tags: ${audit.missingTags.join(', ')}.`,
      whereToBroadcast: audit.recommendedRelays,
      tagsToAdd: [
        ['d', sample.dTag || slugifyShort(sample.title)],
        ['summary', audit.prefillDraft?.summary || '1–2 sentence article hook'],
        ['published_at', String(sample.createdAt)],
        ...audit.suggestedHashtags.slice(0, 3).map((t) => ['t', t]),
      ],
      targetKind: 30023,
      sourcePublicationId: sample.id,
      sourceTitle: sample.title,
      prefillDraft: audit.prefillDraft,
    });
  }

  // Rec 5: Outbox & Relay Hygiene (Kind 10002) — never assumes current relays are right!
  if (
    writeRelays.length > 5 ||
    degradedWriteRelays.length > 0 ||
    mismatchedWriteRelays.length > 0 ||
    !hasMajorDiscoveryRelay ||
    writeRelays.length === 0
  ) {
    const dropCount = relayPlan.relaysToDropOrDemote.length;
    const dropDetail = relayPlan.relaysToDropOrDemote
      .slice(0, 3)
      .map((r) => `${r.url.replace(/^wss:\/\//, '')} (${r.roleLabel})`)
      .join(', ');
    recommendations.push({
      id: 'rec-outbox-hygiene',
      priority:
        writeRelays.length === 0 ||
        degradedWriteRelays.length > 0 ||
        mismatchedWriteRelays.length > 0 ||
        !hasMajorDiscoveryRelay
          ? 'high'
          : 'medium',
      area: 'outbox',
      title:
        dropCount > 0
          ? `Replace ${dropCount} unsuitable write relay${dropCount === 1 ? '' : 's'} with a clean 3–4 relay public outbox`
          : !hasMajorDiscoveryRelay
            ? 'Add high-reach public outbox relays to your Kind 10002 list'
            : writeRelays.length > 5
              ? `Trim NIP-65 write relays from ${writeRelays.length} down to 3–5 fast public endpoints`
              : 'Publish a NIP-65 Kind 10002 relay list for outbox discovery',
      diagnosis: outboxIssues.join(' '),
      whereYouFit:
        'Outbox-model clients (Amethyst, Coracle, Primal, Olas, Nsite gateways) look up your Kind 10002 write relays to find everything you publish. Bridges, encrypted chat relays, and redirecting sockets fragment or hide your catalog.',
      howToFormat: dropCount > 0
        ? `Remove or demote ${dropDetail} from public write outbox, keep your healthy public/community relays, and pair with 2–3 high-reach outbox relays (${recommendedWriteRelays.slice(0, 3).join(', ')}). Run the live relay & audience audit in Distribution to verify latency and follow overlap.`
        : 'Keep 3–5 fast, verified public write relays in Kind 10002, then layer specialty relays (like Wavlake or Yakihonne) when publishing music or articles.',
      whereToBroadcast: recommendedWriteRelays,
      tagsToAdd: relayPlan.proposedKind10002Tags,
      targetKind: 10002,
    });
  }

  // Rec 6: Blossom Mirroring Hygiene (Kind 10063)
  if (blossomServers.length > 5 || blossomServers.length === 0) {
    recommendations.push({
      id: 'rec-blossom-hygiene',
      priority: blossomServers.length === 0 ? 'high' : 'medium',
      area: 'outbox',
      title:
        blossomServers.length === 0
          ? 'Configure 2–3 Blossom servers (Kind 10063) for media & audio hosting'
          : `Consolidate ${blossomServers.length} Blossom servers to 2–4 actively mirrored hosts`,
      diagnosis:
        blossomServers.length === 0
          ? 'No Kind 10063 Blossom servers configured; audio tracks, cover art, and nsites depend on reliable SHA-256 blob hosting.'
          : `${blossomServers.length} Blossom servers are advertised in Kind 10063, but most blobs only live on 1 server — causing broken fallback lookups and low mirror ratios.`,
      whereYouFit: 'Nostr music players, photo feeds, and Nsite gateways try your Kind 10063 Blossom servers in order when loading audio, cover art, and HTML bundles.',
      howToFormat: 'Keep 2–4 reliable Blossom servers in Kind 10063 and mirror every release across all of them.',
      whereToBroadcast: recommendedWriteRelays,
      tagsToAdd: blossomServers.slice(0, 3).map((b) => ['server', b.url]),
      targetKind: 10063,
    });
  }

  // Rec 7: Profile Completeness (Kind 0 — especially lud16 for V4V music!)
  const missingProfileFields: string[] = [];
  if (!profile.lud16) missingProfileFields.push('lud16 (Lightning Address for zaps & V4V music)');
  if (!profile.nip05) missingProfileFields.push('nip05 (verified handle)');
  if (!profile.about) missingProfileFields.push('about (creator bio)');
  if (!profile.picture) missingProfileFields.push('picture (avatar)');
  if (missingProfileFields.length > 0) {
    recommendations.push({
      id: 'rec-profile-discovery',
      priority: !profile.lud16 && hasMusicSignals ? 'high' : 'low',
      area: 'profile',
      title: `Complete Kind 0 profile discovery fields (${missingProfileFields.length} missing)`,
      diagnosis: `Profile metadata is missing ${missingProfileFields.join(', ')}.`,
      whereYouFit: 'Clients use Kind 0 for artist cards, search verification (NIP-05), and Value-for-Value Lightning zaps (lud16).',
      howToFormat: 'Update your Kind 0 metadata JSON with the missing fields and broadcast to your write relays + wss://purplepag.es.',
      whereToBroadcast: mergeRelays(recommendedWriteRelays, ['wss://purplepag.es'], 4),
      tagsToAdd: [],
      targetKind: 0,
    });
  }

  // 7. Compute 4-pillar scores & overall readiness score
  const auditValues = Object.values(publicationAudits);
  const formatAndSpecs =
    auditValues.length > 0
      ? clampScore(auditValues.reduce((s, a) => s + a.formatScore, 0) / auditValues.length)
      : 50;

  const taggedPubsCount = activePubs.filter((p) => p.hashtags.length > 0).length;
  const discoverabilityBase =
    activePubs.length > 0 ? Math.round((taggedPubsCount / activePubs.length) * 75) : 35;
  const profileBonus =
    (profile.display_name || profile.name ? 7 : 0) +
    (profile.about ? 6 : 0) +
    (profile.nip05 ? 6 : 0) +
    (profile.lud16 ? 6 : 0);
  const discoverabilityAndTags = clampScore(discoverabilityBase + profileBonus);
  const broadcastAndOutbox = clampScore(outboxScore);
  const storageAndMedia = clampScore(storageScore);

  const overallScore = clampScore(
    formatAndSpecs * 0.35 +
      discoverabilityAndTags * 0.25 +
      broadcastAndOutbox * 0.25 +
      storageAndMedia * 0.15
  );

  // 8. Determine "Where You Fit" Creator Archetype
  const strengths: string[] = [];
  const blockers: string[] = [];

  if (nsitePubs.length > 0) {
    strengths.push(`${nsitePubs.length} live Nsite static web app${nsitePubs.length === 1 ? '' : 's'} (NIP-5A)`);
  }
  if (articlePubs.length > 0) {
    strengths.push(`${articlePubs.length} long-form NIP-23 article${articlePubs.length === 1 ? '' : 's'}`);
  }
  if (nativeMusicPubs.length > 0) {
    strengths.push(`${nativeMusicPubs.length} native audio track event${nativeMusicPubs.length === 1 ? '' : 's'}`);
  }
  if (profile.nip05) strengths.push(`Verified NIP-05 handle (${profile.nip05})`);
  if (profile.lud16) strengths.push(`Lightning zaps enabled (${profile.lud16})`);
  if (strengths.length === 0) strengths.push('Active Nostr identity with recoverable history');

  if (allUnderFormattedTracks.length > 0) {
    const topMissing = catalogGaps
      .slice(0, 2)
      .map((g) => g.field.split(' (')[0])
      .join(' & ');
    blockers.push(
      `${allUnderFormattedTracks.length}/${nativeMusicPubs.length} music tracks are missing ${topMissing || 'Kind 36787 metadata'} for Nostr music publishers`
    );
  }
  if (trappedMusicSources.length > 0) {
    blockers.push(`Music in "${trappedMusicSources[0].title}" isn't mirrored as standalone Kind 36787 tracks`);
  }
  if (bareMediaKind1Pubs.length > 0) {
    blockers.push(`${bareMediaKind1Pubs.length} bare-URL Kind 1 media posts are skipped by Olas & visual feeds`);
  }
  if (relayPlan.relaysToDropOrDemote.length > 0 || !hasMajorDiscoveryRelay || writeRelays.length > 5) {
    blockers.push(
      relayPlan.relaysToDropOrDemote.length > 0
        ? `${relayPlan.relaysToDropOrDemote.length} write relay${relayPlan.relaysToDropOrDemote.length === 1 ? ' is' : 's are'} broken, bridge-only, or chat-only (${relayPlan.relaysToDropOrDemote
            .slice(0, 2)
            .map((r) => r.url.replace(/^wss:\/\//, ''))
            .join(', ')})`
        : !hasMajorDiscoveryRelay
          ? 'No high-reach public discovery relays (damus / nos.lol / primal) in your write set'
          : `${writeRelays.length} write relays split delivery (trim to 3–5 fast public relays)`
    );
  }
  if (blossomServers.length > 5) {
    blockers.push(`${blossomServers.length} Blossom servers configured without full mirroring`);
  }
  if (taggedPubsCount < Math.ceil(activePubs.length * 0.35) && activePubs.length > 3) {
    blockers.push(`Only ${taggedPubsCount}/${activePubs.length} posts carry #t topic tags for feed discovery`);
  }

  let archetypeLabel = 'Independent Nostr Creator';
  let archetypeHeadline = 'Multi-format publisher ready for specialized Nostr feeds';
  let archetypeExplanation =
    'Your account already publishes real content on Nostr, but specialized clients (music players, picture feeds, long-form readers) only index strict event kinds and tags.';

  if (nativeMusicPubs.length > 0 && allUnderFormattedTracks.length > 0) {
    archetypeLabel = nsitePubs.length > 0
      ? 'Independent Musician & Nsite Builder'
      : 'Nostr Music & V4V Audio Artist';
    archetypeHeadline = `${nativeMusicPubs.length} music track${nativeMusicPubs.length === 1 ? '' : 's'} published — tighten specs & relays for music apps`;
    archetypeExplanation =
      `You already publish real audio events${nsitePubs.length > 0 ? ` alongside ${nsitePubs.length} custom Nsites` : ''}. Filling missing Kind 36787 tags (cover art, duration, imeta, genre #t tags, V4V zap splits) and broadcasting to verified public & music relays unlocks native playback on Amethyst, Gruuv, Wisp, Zapstr, and Wavlake.`;
  } else if (hasMusicSignals && nsitePubs.length > 0) {
    archetypeLabel = 'Independent Musician & Nsite Builder';
    archetypeHeadline = 'Strong web apps & creative output — missing native music-client indexing';
    archetypeExplanation =
      'You already build custom Nsites and share music, which puts you ahead of most creators. Pairing your web players with standalone Kind 36787 tracks (and upgrading bare media drops to Kind 20) unlocks native streaming in Amethyst, Gruuv, Wavlake, and Olas.';
  } else if (hasMusicSignals) {
    archetypeLabel = 'Nostr Music & V4V Audio Artist';
    archetypeHeadline = 'Position your catalog for Kind 36787 streaming and Lightning V4V splits';
    archetypeExplanation =
      'Nostr music discovery revolves around addressable Kind 36787 tracks hosted on Blossom with cover art, duration, genre #t tags, zap splits, and broadcast to music-indexed relays.';
  } else if (nsitePubs.length > 0 && articlePubs.length > 0) {
    archetypeLabel = 'Web Builder & Long-Form Writer';
    archetypeHeadline = 'Pair NIP-5A static sites with complete NIP-23 article cards';
    archetypeExplanation =
      'Your account fits best in Nsite gateways and long-form readers (Yakihonne, Habla, Highlighter). Adding summary excerpts, header banners, and lean NIP-65 outbox relays maximizes reach.';
  } else if (photoPubs.length > 0 || bareMediaKind1Pubs.length >= 2) {
    archetypeLabel = 'Visual Creator';
    archetypeHeadline = 'Shift raw media drops into NIP-68 Kind 20 picture publications';
    archetypeExplanation =
      'Visual clients like Olas and Primal filter for Kind 20 with imeta dimensions and alt text. Adding captions and 2–3 topic tags turns silent links into discoverable portfolio pieces.';
  }

  // Sort recommendations high → medium → low
  const priorityWeight = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => priorityWeight[a.priority] - priorityWeight[b.priority]);

  return {
    overallScore,
    pillars: {
      formatAndSpecs,
      discoverabilityAndTags,
      broadcastAndOutbox,
      storageAndMedia,
    },
    archetype: {
      label: archetypeLabel,
      headline: archetypeHeadline,
      explanation: archetypeExplanation,
      primaryStrengths: strengths.slice(0, 4),
      biggestVisibilityBlockers: blockers.slice(0, 4),
    },
    clientMatrix,
    musicSpotlight: {
      hasMusicSignals,
      detectedTrackCount: nativeMusicPubs.length,
      kind36787Count,
      kind31337Count,
      kindOtherCount,
      underFormattedCount: allUnderFormattedTracks.length,
      catalogGaps,
      underFormattedTracks,
      trappedMusicCount: trappedMusicSources.length,
      trappedMusicSources,
      missingSpecFields: Array.from(musicMissingFields),
      recommendedRelays: relayPlan.recommendedMusicRelays,
      recommendedKind: 36787,
      prefillDraft: musicPrefillDraft,
    },
    outboxDiagnosis: {
      writeRelayCount: writeRelays.length,
      healthyWriteRelayCount: cleanPublicWriteRelays.length,
      degradedWriteRelays,
      mismatchedWriteRelays,
      blossomCount: blossomServers.length,
      recommendedWriteRelays,
      summary: relayPlan.summary,
    },
    relayPlan,
    recommendations,
    publicationAudits,
  };
}
