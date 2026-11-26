/** Conservative metadata extraction; does not execute unknown HTML. */
function decodeEntities(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#(\d{1,7})|#x([0-9a-f]{1,6}));/gi, (match, dec, hex) => {
    const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&#39;': "'" };
    const lower = match.toLowerCase();
    if (Object.hasOwn(named, lower)) return named[lower];
    const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
    return String.fromCodePoint(code);
  });
}

function metaContent(html, attrName, attrValue) {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forward = new RegExp(`<meta\\b[^>]*\\b${attrName}\\s*=\\s*["']${escaped}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`, 'i');
  const reverse = new RegExp(`<meta\\b[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*\\b${attrName}\\s*=\\s*["']${escaped}["']`, 'i');
  return html.match(forward)?.[1] ?? html.match(reverse)?.[1] ?? '';
}

export function htmlMetadata(source) {
  if (typeof source !== 'string') throw new TypeError('HTML string required');
  const html = source
    .slice(0, 512 * 1024)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ');
  const rawTitle = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || metaContent(html, 'property', 'og:title');
  const rawDesc = metaContent(html, 'name', 'description') || metaContent(html, 'property', 'og:description');
  return {
    title: decodeEntities(rawTitle).replace(/\s+/g, ' ').trim().slice(0, 250),
    description: decodeEntities(rawDesc).replace(/\s+/g, ' ').trim().slice(0, 1200),
    headings: [...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]\s*>/gi)]
      .slice(0, 100)
      .map(m => decodeEntities(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  };
}
