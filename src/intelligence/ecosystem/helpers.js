/**
 * Shared helpers, regexes, and defensive input normalizers for the
 * Ecosystem Architecture & Optimization Brain.
 */
import { ECOSYSTEM_DISCOVERY_RELAYS } from '../nipRegistry.js';

export const AUDIO_URL_RE = /https:\/\/[^\s"'<>()]+\.(?:mp3|flac|wav|ogg|m4a|opus)(?:[?#][^\s"'<>()]*)?/i;
export const IMAGE_URL_RE = /https:\/\/[^\s"'<>()]+\.(?:png|jpe?g|webp|gif|avif)(?:[?#][^\s"'<>()]*)?/i;
export const BLOSSOM_SHA_URL_RE = /https:\/\/[^\s"'<>()]+?\/([0-9a-f]{64})(?:\.([a-z0-9]{2,5}))?(?=$|[\s"'<>()?#])/i;
export const MUSIC_DOMAIN_RE = /https:\/\/(?:www\.)?(?:wavlake\.com|soundcloud\.com|bandcamp\.com|zapstr\.live|tunestr\.io|open\.spotify\.com|music\.apple\.com)\/[^\s"'<>()]+/i;
export const MUSIC_SIGNAL_RE = /\b(music|track|song|album|single|ep|beat|beats|synth|audio|remix|player|playlist|soundtrack|mixtape|vocals|lofi|ambient|chao?music)\b/i;
export const GAME_NSITE_RE = /\b(2048|game|survivor|arcade|puzzle|tetris|chess|pong|snake|clicker|zip\s*diff|diff)\b/i;
export const SFX_PATH_RE = /(?:^|\/)(?:sfx|sound|sounds|fx|beep|click|pop|move|win|lose|hit|jump|merge|gameover|coin|ui)[-_a-z0-9]*\.(?:mp3|wav|ogg|m4a|opus)$/i;

export const KEYWORD_TAG_RULES = [
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

export function normalizeProfile(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function normalizeAsset(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  return {
    ...a,
    name: typeof a.name === 'string' ? a.name : '',
    path: typeof a.path === 'string' ? a.path : '',
    mimeType: typeof a.mimeType === 'string' ? a.mimeType : '',
    urls: Array.isArray(a.urls) ? a.urls : [],
    storedOnServers: Array.isArray(a.storedOnServers) ? a.storedOnServers : [],
  };
}

export function normalizePublication(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    ...p,
    id: typeof p.id === 'string' ? p.id : '',
    title: typeof p.title === 'string' ? p.title : '',
    summary: typeof p.summary === 'string' ? p.summary : '',
    content: typeof p.content === 'string' ? p.content : '',
    category: typeof p.category === 'string' ? p.category : 'post',
    kind: Number.isSafeInteger(p.kind) ? p.kind : 1,
    createdAt: Number.isFinite(p.createdAt) ? p.createdAt : 0,
    deleted: Boolean(p.deleted),
    tags: Array.isArray(p.tags) ? p.tags : [],
    hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
    assets: Array.isArray(p.assets) ? p.assets.map(normalizeAsset) : [],
  };
}

export function isLikelyMusicNsite(pub, audioPaths) {
  const dTag = getTagValue(pub.tags, 'd') || pub.dTag || '';
  const identityText = `${pub.title} ${dTag}`;
  if (GAME_NSITE_RE.test(identityText)) return false;
  const musicAudioPaths = audioPaths.filter((a) => !SFX_PATH_RE.test(a.path || a.name));
  const hasMusicIdentity = MUSIC_SIGNAL_RE.test(`${pub.title} ${dTag} ${pub.summary}`);
  if (hasMusicIdentity) return true;
  if (musicAudioPaths.length >= 2) return true;
  return (
    musicAudioPaths.length === 1 &&
    /(track|song|music|album|audio|mix)/i.test(musicAudioPaths[0].path || musicAudioPaths[0].name)
  );
}

export function slugifyShort(value, maxLen = 28) {
  const clean = String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (clean || 'release').slice(0, maxLen).replace(/-+$/, '');
}

export function getTagValue(tags, key) {
  if (!Array.isArray(tags)) return undefined;
  return tags.find((t) => Array.isArray(t) && t[0] === key && typeof t[1] === 'string' && t[1].trim().length > 0)?.[1]?.trim();
}

export function getImetaFields(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t) => Array.isArray(t) && t[0] === 'imeta')
    .map((tag) => {
      const record = {};
      for (const item of tag.slice(1)) {
        if (typeof item !== 'string') continue;
        const sp = item.indexOf(' ');
        if (sp === -1) continue;
        const k = item.slice(0, sp).trim();
        const v = item.slice(sp + 1).trim();
        if (k && v) record[k] = v;
      }
      return record;
    });
}

export function inferTagsFromText(text, existing, defaults) {
  const safeText = String(text ?? '');
  const existingSet = new Set((Array.isArray(existing) ? existing : []).map((t) => String(t).toLowerCase()));
  const suggested = [];
  for (const tag of Array.isArray(defaults) ? defaults : []) {
    if (!existingSet.has(tag)) {
      suggested.push(tag);
      existingSet.add(tag);
    }
  }
  for (const rule of KEYWORD_TAG_RULES) {
    if (rule.pattern.test(safeText) && !existingSet.has(rule.tag)) {
      suggested.push(rule.tag);
      existingSet.add(rule.tag);
    }
    if (suggested.length >= 5) break;
  }
  return suggested;
}

export function isBareUrlNote(content) {
  const trimmed = String(content ?? '').trim();
  if (!trimmed || trimmed.includes('\n')) {
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

export function mergeRelays(primary, extra, limit = 5) {
  const safePrimary = Array.isArray(primary) ? primary : [];
  const safeExtra = Array.isArray(extra) ? extra : [];
  const seen = new Set();
  const out = [];
  const add = (url) => {
    if (typeof url !== 'string') return;
    const clean = url.trim().replace(/\/$/, '');
    if (!clean.startsWith('wss://') || seen.has(clean) || out.length >= limit) return;
    seen.add(clean);
    out.push(clean);
  };
  const generalSet = new Set(ECOSYSTEM_DISCOVERY_RELAYS.generalOutbox);
  const specialty = safeExtra.filter((r) => !generalSet.has(r));
  const reservedPrimaryCount = Math.max(1, limit - specialty.length);
  for (const r of safePrimary.slice(0, reservedPrimaryCount)) add(r);
  for (const r of specialty) add(r);
  for (const r of safeExtra) add(r);
  for (const r of safePrimary) add(r);
  return out;
}

export function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
