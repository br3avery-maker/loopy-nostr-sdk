import { endpoint } from '../core/urls.js';

/** Pure, stateless NIP-19 bech32 + TLV codec with strict BIP-173 case & checksum checks. */
const ABC = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const VALID_HEX = /^[a-f\d]{64}$/i;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const utf8Encode = new TextEncoder();

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][i];
  }
  return chk >>> 0;
}

function expand(hrp) {
  return [...hrp].map(c => c.charCodeAt(0) >>> 5).concat(0, [...hrp].map(c => c.charCodeAt(0) & 31));
}

function toBytes(words) {
  let acc = 0;
  let bits = 0;
  const out = [];
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 255);
    }
  }
  if (bits >= 5 || (acc << (8 - bits)) & 255) return null;
  return Uint8Array.from(out);
}

function hex(buf) {
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

export function decodeNip19(value) {
  if (typeof value !== 'string') throw new TypeError('NIP-19 string required');
  const s = value.trim().replace(/^nostr:/i, '');
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) throw new Error('Mixed-case bech32 identifier');
  const t = s.toLowerCase();
  const p = t.lastIndexOf('1');
  if (p <= 0 || p + 7 > t.length || t.length > 5000) throw new Error('Invalid NIP-19 length');
  const hrp = t.slice(0, p);
  const chars = t.slice(p + 1);
  const words = [];
  for (const c of chars) {
    const i = ABC.indexOf(c);
    if (i < 0) throw new Error('Invalid NIP-19 alphabet');
    words.push(i);
  }
  if (polymod([...expand(hrp), ...words]) !== 1) throw new Error('Invalid NIP-19 checksum');
  const raw = toBytes(words.slice(0, -6));
  if (!raw) throw new Error('Invalid NIP-19 bits');
  if (hrp === 'npub' || hrp === 'note') {
    if (raw.length !== 32) throw new Error('NIP-19 public key/event ID must be 32 bytes');
    return { type: hrp, hex: hex(raw) };
  }
  if (hrp === 'nprofile' || hrp === 'nevent' || hrp === 'naddr') {
    let i = 0;
    let pubkey = null;
    let eventId = null;
    let author = null;
    const relays = [];
    let identifier = null;
    let kind = null;
    while (i < raw.length) {
      if (i + 2 > raw.length) throw new Error('Incomplete NIP-19 TLV');
      const tag = raw[i++];
      const len = raw[i++];
      if (i + len > raw.length) throw new Error('Truncated NIP-19 TLV');
      const val = raw.subarray(i, i + len);
      i += len;
      if (tag === 0) {
        if (hrp === 'naddr') identifier = utf8.decode(val);
        else if (len === 32) {
          if (hrp === 'nevent') eventId = hex(val);
          else pubkey = hex(val);
        }
      }
      if (tag === 1) {
        try {
          const relay = endpoint(utf8.decode(val), 'relay');
          if (!relays.includes(relay)) relays.push(relay);
        } catch {}
      }
      if (tag === 2 && len === 32) {
        if (hrp === 'naddr') pubkey = hex(val);
        else if (hrp === 'nevent') author = hex(val);
      }
      if (tag === 3 && len === 4 && hrp !== 'nprofile') kind = new DataView(val.buffer, val.byteOffset, 4).getUint32(0, false);
    }
    if (hrp === 'nevent') {
      if (!eventId) throw new Error('NIP-19 missing event ID');
      return { type: hrp, hex: eventId, author, relays, identifier, kind };
    }
    if (!pubkey) throw new Error('NIP-19 address missing pubkey');
    return { type: hrp, hex: pubkey, relays, identifier, kind };
  }
  throw new Error('Unsupported NIP-19 prefix');
}

function toWords(bytes) {
  let acc = 0;
  let bits = 0;
  const out = [];
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

function bech32Encode(hrp, dataBytes) {
  const words = toWords(dataBytes);
  const mod = polymod([...expand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >>> (5 * (5 - i))) & 31);
  const encoded = hrp + '1' + [...words, ...checksum].map(w => ABC[w]).join('');
  if (encoded.length > 5000) throw new RangeError('NIP-19 identifier exceeds 5000 characters');
  return encoded;
}

function fromHex32(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${label} must be 64-char lowercase hex`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function encodeTlv(entries) {
  let total = 0;
  for (const { value } of entries) {
    if (value.length > 255) throw new RangeError('NIP-19 TLV entry exceeds 255 bytes');
    total += 2 + value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const { type, value } of entries) {
    out[offset++] = type;
    out[offset++] = value.length;
    out.set(value, offset);
    offset += value.length;
  }
  return out;
}

function relayTlvs(relays = []) {
  if (!Array.isArray(relays)) throw new TypeError('relays must be an array');
  const seen = new Set();
  const entries = [];
  for (const raw of relays) {
    const canonical = endpoint(raw, 'relay');
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    entries.push({ type: 1, value: utf8Encode.encode(canonical) });
  }
  return entries;
}

function uint32Be(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new TypeError(`${label} must be a 32-bit unsigned integer`);
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

export function noteEncode(eventId) {
  return bech32Encode('note', fromHex32(eventId, 'eventId'));
}

export function nprofileEncode({ pubkey, relays = [] } = {}) {
  const entries = [{ type: 0, value: fromHex32(pubkey, 'pubkey') }, ...relayTlvs(relays)];
  return bech32Encode('nprofile', encodeTlv(entries));
}

export function neventEncode({ id, relays = [], author, kind } = {}) {
  const entries = [{ type: 0, value: fromHex32(id, 'id') }, ...relayTlvs(relays)];
  if (author !== undefined && author !== null) {
    entries.push({ type: 2, value: fromHex32(author, 'author') });
  }
  if (kind !== undefined && kind !== null) {
    if (!Number.isSafeInteger(kind) || kind < 0 || kind > 65535) {
      throw new TypeError('kind must be an integer in 0..65535');
    }
    entries.push({ type: 3, value: uint32Be(kind, 'kind') });
  }
  return bech32Encode('nevent', encodeTlv(entries));
}

export function naddrEncode({ identifier = '', pubkey, kind, relays = [] } = {}) {
  if (typeof identifier !== 'string') throw new TypeError('identifier must be a string');
  if (!Number.isSafeInteger(kind) || kind < 0 || kind > 65535) {
    throw new TypeError('kind must be an integer in 0..65535');
  }
  const entries = [
    { type: 0, value: utf8Encode.encode(identifier) },
    ...relayTlvs(relays),
    { type: 2, value: fromHex32(pubkey, 'pubkey') },
    { type: 3, value: uint32Be(kind, 'kind') },
  ];
  return bech32Encode('naddr', encodeTlv(entries));
}

export function normalizePubkey(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/^nostr:/i, '');
  if (VALID_HEX.test(s)) return s.toLowerCase();
  try {
    const d = decodeNip19(s);
    return ['npub', 'nprofile', 'naddr'].includes(d.type) ? d.hex : null;
  } catch {
    return null;
  }
}
