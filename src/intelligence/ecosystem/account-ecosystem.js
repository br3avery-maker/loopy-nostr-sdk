/**
 * Full Account Ecosystem Architecture & Optimization Brain.
 * Evaluates where the user fits, what is holding back visibility, and produces concrete
 * format + tag + broadcast upgrades across Music, Articles, Photos, Nsites, and Outbox infrastructure.
 */
import { ECOSYSTEM_DISCOVERY_RELAYS } from '../nipRegistry.js';
import { buildRelayOptimizationPlan } from '../relayIntelligence.js';
import {
  AUDIO_URL_RE,
  IMAGE_URL_RE,
  BLOSSOM_SHA_URL_RE,
  MUSIC_DOMAIN_RE,
  MUSIC_SIGNAL_RE,
  isLikelyMusicNsite,
  slugifyShort,
  isBareUrlNote,
  mergeRelays,
  clampScore,
  normalizeProfile,
  normalizePublication,
} from './helpers.js';
import { auditSinglePublication } from './single-publication.js';

export function analyzeAccountEcosystem(params = {}) {
  const safeParams = params && typeof params === 'object' ? params : {};
  const profile = normalizeProfile(safeParams.profile);
  const relays = Array.isArray(safeParams.relays) ? safeParams.relays.filter((r) => r && typeof r === 'object') : [];
  const blossomServers = Array.isArray(safeParams.blossomServers)
    ? safeParams.blossomServers.filter((b) => b && typeof b === 'object')
    : [];
  const preferredLicense = safeParams.preferredLicense;
  const activePubs = (Array.isArray(safeParams.publications) ? safeParams.publications : [])
    .map(normalizePublication)
    .filter((p) => !p.deleted);
  const authorName = profile.display_name || profile.name || 'Creator';

  // 1. Outbox, Relay Fitness & Blossom infrastructure analysis
  const hasAnyMusicHint =
    activePubs.some(
      (p) => p.kind === 36787 || p.kind === 31337 || p.kind === 32123 || p.category === 'music'
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
    .filter((r) => r.write && (r.roleClass === 'general-outbox' || r.roleClass === 'community-niche'))
    .map((r) => r.url);
  const healthyWriteRelays = relayPlan.recommendedWriteRelays;
  const recommendedWriteRelays = relayPlan.recommendedWriteRelays;

  let outboxScore = 100;
  const outboxIssues = [];
  if (writeRelays.length === 0) {
    outboxScore -= 55;
    outboxIssues.push('No NIP-65 write relays configured (Kind 10002).');
  } else if (writeRelays.length > 5) {
    outboxScore -= 18;
    outboxIssues.push(`${writeRelays.length} write relays advertised — NIP-65 outbox works best with 3–5 fast public relays.`);
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
  const hasMajorDiscoveryRelay = relayPlan.auditedRelays.some((r) => r.write && r.roleClass === 'general-outbox');
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
  const publicationAudits = {};
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
  const trappedMusicSources = [];
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
  const hasMusicSignals =
    nativeMusicPubs.length > 0 || trappedMusicSources.length > 0 || MUSIC_SIGNAL_RE.test(profile.about || '');
  const musicMissingFields = new Set();
  if (kind36787Count === 0) musicMissingFields.add('Kind 36787 track events (Amethyst / Gruuv / Wisp)');
  if (!profile.lud16) musicMissingFields.add('Kind 0 lud16 Lightning Address (V4V zaps)');
  if (!writeRelays.some((r) => typeof r.url === 'string' && r.url.includes('wavlake'))) {
    musicMissingFields.add('Music relay broadcast (wss://relay.wavlake.com)');
  }

  const gapCounter = new Map();
  const auditedNativeTracks = nativeMusicPubs
    .map((track) => ({ track, audit: publicationAudits[track.id] }))
    .filter((entry) => Boolean(entry.audit))
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
  const musicPrefillDraft = primaryMusicSource || {
    label: 'Prepare Kind 36787 music release',
    rationale:
      'Creates a fully compliant Kind 36787 music track with Blossom audio, cover art, artist attribution, genre #t tags, license, V4V zap split, and music discovery relays.',
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
  const bareUrlKind1Pubs = activePubs.filter((p) => p.kind === 1 && isBareUrlNote(p.content).isBare);
  const bareMediaKind1Pubs = bareUrlKind1Pubs.filter(
    (p) => IMAGE_URL_RE.test(p.content) || BLOSSOM_SHA_URL_RE.test(p.content) || p.assets.length > 0
  );

  // 5. Client Compatibility Matrix ("Where You Fit")
  const clientMatrix = [];
  const amethystStatus =
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

  const articleAudits = articlePubs.map((p) => publicationAudits[p.id]).filter(Boolean);
  const avgArticleScore =
    articleAudits.length > 0
      ? Math.round(articleAudits.reduce((s, a) => s + a.formatScore, 0) / articleAudits.length)
      : 0;
  const articleStatus = articlePubs.length === 0 ? 'invisible' : avgArticleScore >= 82 ? 'ready' : 'partial';
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

  const photoAudits = photoPubs.map((p) => publicationAudits[p.id]).filter(Boolean);
  const avgPhotoScore =
    photoAudits.length > 0
      ? Math.round(photoAudits.reduce((s, a) => s + a.formatScore, 0) / photoAudits.length)
      : 0;
  const photoStatus =
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

  const nsiteAudits = nsitePubs.map((p) => publicationAudits[p.id]).filter(Boolean);
  const nsiteStatus =
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
  const recommendations = [];
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
      id: 'rec-music-catalog-upgrade',
      priority: 'high',
      area: 'music',
      title: `Optimize ${allUnderFormattedTracks.length} of ${nativeMusicPubs.length} music track${nativeMusicPubs.length === 1 ? '' : 's'} for music publishers`,
      diagnosis: `Recovered ${nativeMusicPubs.length} native audio events (${kindBreakdown}). ${topGapSummary ? `Catalog gaps: ${topGapSummary}.` : weakest.audit.diagnosis}`,
      whereYouFit:
        'Amethyst, Gruuv, Wisp, Zapstr, and Wavlake rely on Kind 36787 with direct audio url, imeta, cover art, artist, duration, genre #t tags, and V4V zap splits.',
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

  if (trappedMusicSources.length > 0) {
    const first = trappedMusicSources[0];
    const trappedPrefill = publicationAudits[first.publicationId]?.prefillDraft || musicPrefillDraft;
    recommendations.push({
      id: `rec-music-trapped-${first.publicationId}`,
      priority: allUnderFormattedTracks.length > 0 ? 'medium' : 'high',
      area: 'music',
      title: `Publish standalone Kind 36787 tracks for "${first.title}"`,
      diagnosis: first.reason,
      whereYouFit:
        'Amethyst, Gruuv, Wisp, Zapstr, and Wavlake index addressable Kind 36787 (and Kind 31337) music events — not HTML web players or Kind 1 links.',
      howToFormat:
        'Sign one Kind 36787 event per song pointing at your Blossom SHA-256 audio file, paired with square cover artwork, duration, license, V4V zap split, and genre #t tags.',
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

  if (bareMediaKind1Pubs.length > 0) {
    const sample = bareMediaKind1Pubs[0];
    const sampleAudit = publicationAudits[sample.id];
    recommendations.push({
      id: 'rec-bare-media-kind20',
      priority: 'high',
      area: 'photos',
      title: `Upgrade ${bareMediaKind1Pubs.length} bare-URL media note${bareMediaKind1Pubs.length === 1 ? '' : 's'} to NIP-68 Kind 20`,
      diagnosis: `${bareMediaKind1Pubs.length} Kind 1 post${bareMediaKind1Pubs.length === 1 ? ' is' : 's are'} just a raw Blossom/media URL with no caption, no imeta, no alt text, and no hashtags.`,
      whereYouFit:
        'Olas, Primal Pictures, and Amethyst visual feeds specifically query Kind 20 with imeta + alt text and skip bare Kind 1 URL drops.',
      howToFormat:
        'Publish visual drops as Kind 20 with imeta (url, m, x, dim, alt), a concise title, and 2–3 topic #t tags.',
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
      whereYouFit:
        'Yakihonne, Habla, and Highlighter display Kind 30023 articles as rich cards using summary, header image, published_at, and #t tags.',
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
      howToFormat:
        dropCount > 0
          ? `Remove or demote ${dropDetail} from public write outbox, keep your healthy public/community relays, and pair with 2–3 high-reach outbox relays (${recommendedWriteRelays.slice(0, 3).join(', ')}). Run the live relay & audience audit in Distribution to verify latency and follow overlap.`
          : 'Keep 3–5 fast, verified public write relays in Kind 10002, then layer specialty relays (like Wavlake or Yakihonne) when publishing music or articles.',
      whereToBroadcast: recommendedWriteRelays,
      tagsToAdd: relayPlan.proposedKind10002Tags,
      targetKind: 10002,
    });
  }

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
      whereYouFit:
        'Nostr music players, photo feeds, and Nsite gateways try your Kind 10063 Blossom servers in order when loading audio, cover art, and HTML bundles.',
      howToFormat: 'Keep 2–4 reliable Blossom servers in Kind 10063 and mirror every release across all of them.',
      whereToBroadcast: recommendedWriteRelays,
      tagsToAdd: blossomServers.slice(0, 3).map((b) => ['server', b.url]),
      targetKind: 10063,
    });
  }

  const missingProfileFields = [];
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
      whereYouFit:
        'Clients use Kind 0 for artist cards, search verification (NIP-05), and Value-for-Value Lightning zaps (lud16).',
      howToFormat:
        'Update your Kind 0 metadata JSON with the missing fields and broadcast to your write relays + wss://purplepag.es.',
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
  const discoverabilityBase = activePubs.length > 0 ? Math.round((taggedPubsCount / activePubs.length) * 75) : 35;
  const profileBonus =
    (profile.display_name || profile.name ? 7 : 0) +
    (profile.about ? 6 : 0) +
    (profile.nip05 ? 6 : 0) +
    (profile.lud16 ? 6 : 0);
  const discoverabilityAndTags = clampScore(discoverabilityBase + profileBonus);
  const broadcastAndOutbox = clampScore(outboxScore);
  const storageAndMedia = clampScore(storageScore);
  const overallScore = clampScore(
    formatAndSpecs * 0.35 + discoverabilityAndTags * 0.25 + broadcastAndOutbox * 0.25 + storageAndMedia * 0.15
  );

  // 8. Determine "Where You Fit" Creator Archetype
  const strengths = [];
  const blockers = [];
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
    archetypeLabel =
      nsitePubs.length > 0 ? 'Independent Musician & Nsite Builder' : 'Nostr Music & V4V Audio Artist';
    archetypeHeadline = `${nativeMusicPubs.length} music track${nativeMusicPubs.length === 1 ? '' : 's'} published — tighten specs & relays for music apps`;
    archetypeExplanation = `You already publish real audio events${nsitePubs.length > 0 ? ` alongside ${nsitePubs.length} custom Nsites` : ''}. Filling missing Kind 36787 tags (cover art, duration, imeta, genre #t tags, V4V zap splits) and broadcasting to verified public & music relays unlocks native playback on Amethyst, Gruuv, Wisp, Zapstr, and Wavlake.`;
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
