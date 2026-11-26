/** URL policies shared by transports; deliberately fail closed on credentials/fragments. */

export function isPrivateOrLocalHost(hostname) {
  if (typeof hostname !== 'string') return true;
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return (
    !host ||
    !host.includes('.') ||
    host.includes(':') ||
    /^\d+(?:\.\d+){3}$/.test(host) ||
    /\.(?:localhost|local|internal|home\.arpa)$/.test(host)
  );
}

export function endpoint(input, type = 'relay', { publicHost } = {}) {
  let url; try { url = new URL(input); } catch { throw new TypeError(`Invalid ${type} URL`); }
  const scheme = type === 'relay' ? 'wss:' : 'https:';
  if (url.protocol !== scheme || !url.hostname || url.username || url.password || url.hash || url.search) {
    throw new TypeError(`${type} must be a plain ${scheme}// endpoint`);
  }
  // Canonicalize trailing dots and lowercase hostname so deduplication and host guards agree.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new TypeError(`Invalid ${type} URL`);
  url.hostname = host;
  // Untrusted Blossom hints (or callers requesting publicHost) must use public DNS names,
  // not literal addresses or local names. Syntactic guard only, not DNS resolution.
  const requirePublicHost = publicHost !== undefined ? Boolean(publicHost) : type !== 'relay';
  if (requirePublicHost && isPrivateOrLocalHost(host)) {
    throw new TypeError(
      type === 'relay'
        ? 'Private/loopback relay endpoint disallowed; named public WSS host required'
        : 'Private/loopback Blossom endpoint disallowed by default; named HTTPS host required'
    );
  }
  return url.href.replace(/\/$/, '');
}

export function endpoints(values, type = 'relay', max = 32, options = {}) {
  if (!Array.isArray(values)) throw new TypeError('Expected an array of endpoints');
  if (!Number.isSafeInteger(max) || max < 0) throw new RangeError('Invalid maximum endpoint count');
  const entries = [...new Set(values.map(x => endpoint(x, type, options)))];
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
