/**
 * Shared pure helpers for the Nostr Intelligence preparation & coverage engine.
 */
import { endpoint } from '../../core/urls.js';

export function canonicalUrl(value, type) {
  if (typeof value !== 'string') return '';
  try {
    return endpoint(value, type);
  } catch {
    return value.trim().replace(/\/+$/, '').toLowerCase();
  }
}

export function slugify(value) {
  const cleaned = String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'untitled-release';
}

export function nsiteSlugify(value) {
  const cleaned = slugify(value).slice(0, 13).replace(/-+$/, '');
  return cleaned || 'site';
}

export function titleFromFilename(filename) {
  const safe = String(filename ?? '');
  const base = safe.split('/').pop() || safe;
  const withoutExt = base.replace(/\.[^/.]+$/, '');
  const withoutTrackNum = withoutExt.replace(/^\d{1,3}[\s._-]+/, '');
  return withoutTrackNum
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isAudioAsset(asset) {
  const mime = String(asset?.mimeType || '');
  const name = String(asset?.name || '');
  return mime.startsWith('audio/') || /\.(mp3|flac|wav|ogg|m4a|opus)$/i.test(name);
}

export function isImageAsset(asset) {
  const mime = String(asset?.mimeType || '');
  const name = String(asset?.name || '');
  return mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(name);
}

export function isMarkdownAsset(asset) {
  const mime = String(asset?.mimeType || '');
  const name = String(asset?.name || '');
  return mime === 'text/markdown' || /\.(md|markdown)$/i.test(name);
}

export function isSiteArchiveOrHtml(asset) {
  const mime = String(asset?.mimeType || '');
  const name = String(asset?.name || '');
  return (
    mime === 'application/zip' ||
    mime === 'text/html' ||
    /\.zip$/i.test(name) ||
    /(^|\/)index\.html?$/i.test(asset?.path || name)
  );
}

export function extractMarkdownFrontmatter(text) {
  let body = String(text ?? '').trim();
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
        if (colon === -1) continue;
        const key = line.slice(0, colon).trim().toLowerCase();
        const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
        if (key === 'title' && val) title = val;
        if ((key === 'summary' || key === 'description') && val) summary = val;
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
    if (h1) title = h1[1].trim();
  }
  if (!summary) {
    const paragraphs = body
      .replace(/^#+\s+.+$/gm, '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs[0]) summary = paragraphs[0].slice(0, 180);
  }
  return { title, summary, tags, body };
}

export function extractInlineHashtags(text) {
  const matches = String(text ?? '').match(/#([a-zA-Z0-9_-]{2,32})/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1).toLowerCase())));
}
