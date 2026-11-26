/** URL policies shared by transports; deliberately fail closed on credentials/fragments. */
export function endpoint(input, type = 'relay') {
  let url; try { url = new URL(input); } catch { throw new TypeError(`Invalid ${type} URL`); }
  const scheme = type === 'relay' ? 'wss:' : 'https:';
  if (url.protocol !== scheme || !url.hostname || url.username || url.password || url.hash || url.search) throw new TypeError(`${type} must be a plain ${scheme}// endpoint`);
  // Untrusted Blossom hints must use DNS names, not literal addresses or local names.
  // This syntactic guard is not DNS resolution or a server-side egress policy.
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  if(type!=='relay'&&(!host.includes('.')||host.includes(':')||/^\d+(?:\.\d+){3}$/.test(host)||/\.(?:localhost|local|internal)$/.test(host)))throw new TypeError('Private/loopback Blossom endpoint disallowed by default; named HTTPS host required');
  return url.href.replace(/\/$/, '');
}
export function endpoints(values, type='relay', max=32) {
  if (!Array.isArray(values)) throw new TypeError('Expected an array of endpoints');
  const entries = [...new Set(values.map(x => endpoint(x, type)))];
  if (entries.length > max) throw new RangeError(`Maximum ${max} endpoints`);
  return entries;
}
export function nsitePath(input) {
  if (typeof input !== 'string' || !input || input.includes('\\') || /[?#\u0000-\u001f]/.test(input)) throw new TypeError('Invalid nsite path');
  const path = '/' + input.replace(/^\/+/, '');
  if (path === '/' || path.slice(1).split('/').some(seg => !seg || seg === '.' || seg === '..' || /%2e|%2f|%5c/i.test(seg))) throw new TypeError('Unsafe nsite path');
  if (path.length > 4096) throw new RangeError('Path too long');
  return path;
}
export function slug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,13}$/.test(value) || value.endsWith('-')) throw new TypeError('Invalid nsite identifier');
  return value;
}
