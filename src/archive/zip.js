import { bytes, encode } from '../core/bytes.js';
import { nsitePath } from '../core/urls.js';

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(input) {
  let crc = 0xffffffff;
  for (const b of bytes(input)) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const u16 = (d, o) => d.getUint16(o, true);
const u32 = (d, o) => d.getUint32(o, true);
const text = new TextDecoder('utf-8', { fatal: true });

/** Stream-bounded Web Streams inflateRaw (works in modern browsers and Node 20+). */
async function streamInflateRaw(encoded, maxBytes) {
  const ds = new globalThis.DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const writePromise = writer
    .write(encoded)
    .then(() => writer.close())
    .catch(() => {});
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const chunk = step.value instanceof Uint8Array ? step.value : new Uint8Array(step.value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw new Error('ZIP expansion budget exceeded');
      }
      chunks.push(chunk);
    }
    await writePromise;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return out;
}

/** Strict central-directory ZIP reader (stored and DEFLATE; no ZIP64, encryption or symlink entries). */
export async function readZip(input, { maxFiles = 20000, maxOutputBytes = 128 * 1024 * 1024, maxRatio = 400, inflate } = {}) {
  if (
    !Number.isSafeInteger(maxFiles) ||
    maxFiles < 0 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 0 ||
    !Number.isFinite(maxRatio) ||
    maxRatio < 1
  ) {
    throw new RangeError('Invalid ZIP extraction limits');
  }
  const raw = bytes(input);
  const d = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const length = raw.byteLength;
  let end = -1;
  for (let i = length - 22; i >= Math.max(0, length - 65557); i--) {
    if (u32(d, i) === 0x06054b50 && i + 22 + u16(d, i + 20) === length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('ZIP end-of-central-directory not found');
  if (u16(d, end + 4) !== 0 || u16(d, end + 6) !== 0) throw new Error('Multipart ZIP unsupported');
  const count = u16(d, end + 10);
  const csize = u32(d, end + 12);
  const coff = u32(d, end + 16);
  if (count === 0xffff || csize === 0xffffffff || coff === 0xffffffff) throw new Error('ZIP64 unsupported');
  if (count > maxFiles || u16(d, end + 8) !== count || coff + csize > end) throw new Error('Bad ZIP directory bounds');

  const seen = new Set();
  const out = Object.create(null);
  let pos = coff;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > coff + csize || u32(d, pos) !== 0x02014b50) throw new Error('Invalid ZIP central header');
    const flag = u16(d, pos + 8);
    const method = u16(d, pos + 10);
    const expectedCRC = u32(d, pos + 16);
    const csize2 = u32(d, pos + 20);
    const size = u32(d, pos + 24);
    const fn = u16(d, pos + 28);
    const extra = u16(d, pos + 30);
    const comment = u16(d, pos + 32);
    const external = u32(d, pos + 38);
    const offset = u32(d, pos + 42);
    const endname = pos + 46 + fn;
    if (csize2 === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new Error('ZIP64 unsupported');
    if (endname + extra + comment > coff + csize) throw new Error('ZIP entry metadata out of bounds');
    const name = text.decode(raw.subarray(pos + 46, endname));
    pos = endname + extra + comment;
    if (name.endsWith('/')) continue;
    const path = nsitePath(name).slice(1);
    const unixMode = (external >>> 16) & 0xf000;
    if (unixMode === 0xa000 || flag & 1 || flag & 0x40 || ![0, 8].includes(method)) {
      throw new Error('ZIP member unsupported or unsafe');
    }
    if (seen.has(path)) throw new Error('Duplicate ZIP member ' + path);
    seen.add(path);
    total += size;
    if (total > maxOutputBytes || size > Math.max(csize2, 1) * maxRatio) {
      throw new Error('ZIP expansion budget exceeded');
    }
    if (offset + 30 > length || u32(d, offset) !== 0x04034b50) throw new Error('ZIP local header missing');
    const localMethod = u16(d, offset + 8);
    const localFn = u16(d, offset + 26);
    const localExtra = u16(d, offset + 28);
    if (localMethod !== method) throw new Error('ZIP local/central method mismatch');
    const dataOffset = offset + 30 + localFn + localExtra;
    if (dataOffset + csize2 > coff) throw new Error('ZIP payload out of bounds');
    const encoded = raw.subarray(dataOffset, dataOffset + csize2);
    let value;
    if (method === 0) {
      value = encoded;
    } else if (inflate) {
      value = await inflate(encoded);
    } else if (typeof globalThis.DecompressionStream === 'function') {
      value = await streamInflateRaw(encoded, Math.min(size, maxOutputBytes));
    } else if (typeof process !== 'undefined' && process.versions?.node) {
      const { inflateRawSync } = await import('node:zlib');
      value = inflateRawSync(encoded, { maxOutputLength: Math.min(size, maxOutputBytes) });
    } else {
      throw new Error('Deflate provider required for this browser; provide inflate(bytes)');
    }
    if (value.length !== size || crc32(value) !== expectedCRC) throw new Error('ZIP CRC or size mismatch ' + path);
    out[path] = new Uint8Array(value);
  }
  return out;
}

/** Deterministic standards-compliant ZIP writer (stored method) with CRC and central directory. */
export function writeZip(fileMap, { maxFiles = 20000, maxBytes = 128 * 1024 * 1024 } = {}) {
  if (!fileMap || typeof fileMap !== 'object' || Array.isArray(fileMap)) {
    throw new TypeError('File map object required');
  }
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('Invalid ZIP write limits');
  }
  const sorted = Object.entries(fileMap)
    .map(([name, data]) => ({ name: nsitePath(name).slice(1), data: bytes(data) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (sorted.length > maxFiles || sorted.length > 65535) throw new RangeError('Too many ZIP entries');
  const used = new Set();
  let cursor = 0;
  let total = 0;
  const sections = [];
  const cent = [];
  const h = size => new Uint8Array(size);
  const put16 = (d, o, v) => new DataView(d.buffer).setUint16(o, v, true);
  const put32 = (d, o, v) => new DataView(d.buffer).setUint32(o, v, true);
  const join = parts => {
    const size = parts.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(size);
    let p = 0;
    for (const a of parts) {
      out.set(a, p);
      p += a.length;
    }
    return out;
  };
  for (const f of sorted) {
    if (used.has(f.name)) throw new Error('Duplicate ZIP path');
    used.add(f.name);
    total += f.data.length;
    if (total > maxBytes) throw new RangeError('ZIP exceeds byte budget');
    const name = encode(f.name);
    const crc = crc32(f.data);
    if (name.length > 65535) throw new RangeError('ZIP name too long');
    if (cursor > 0xffffffff || f.data.length > 0xffffffff) throw new RangeError('ZIP64 size limit exceeded');
    const local = h(30);
    put32(local, 0, 0x04034b50);
    put16(local, 4, 20);
    put16(local, 6, 0x800);
    put32(local, 14, crc);
    put32(local, 18, f.data.length);
    put32(local, 22, f.data.length);
    put16(local, 26, name.length);
    sections.push(local, name, f.data);
    const central = h(46);
    put32(central, 0, 0x02014b50);
    put16(central, 4, 20);
    put16(central, 6, 20);
    put16(central, 8, 0x800);
    put32(central, 16, crc);
    put32(central, 20, f.data.length);
    put32(central, 24, f.data.length);
    put16(central, 28, name.length);
    put32(central, 42, cursor);
    cent.push(central, name);
    cursor += local.length + name.length + f.data.length;
  }
  const centralBytes = join(cent);
  if (cursor > 0xffffffff || centralBytes.length > 0xffffffff) throw new RangeError('ZIP64 size limit exceeded');
  const footer = h(22);
  put32(footer, 0, 0x06054b50);
  put16(footer, 8, sorted.length);
  put16(footer, 10, sorted.length);
  put32(footer, 12, centralBytes.length);
  put32(footer, 16, cursor);
  return join([...sections, centralBytes, footer]);
}

/** Stream-bounded Web Streams deflateRaw (works in modern browsers and Node 20+). */
async function streamDeflateRaw(raw) {
  const cs = new globalThis.CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  const writePromise = writer
    .write(raw)
    .then(() => writer.close())
    .catch(() => {});
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const chunk = step.value instanceof Uint8Array ? step.value : new Uint8Array(step.value);
      total += chunk.byteLength;
      chunks.push(chunk);
    }
    await writePromise;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return out;
}

/**
 * Deterministic async ZIP writer supporting opt-in DEFLATE compression (`method 8`).
 * Uses custom `deflate(bytes)`, `CompressionStream('deflate-raw')`, or `node:zlib` `deflateRawSync`,
 * and automatically falls back to stored (`method 0`) per entry when compression does not shrink it.
 */
export async function writeZipAsync(
  fileMap,
  { maxFiles = 20000, maxBytes = 128 * 1024 * 1024, compress = true, deflate } = {}
) {
  if (!fileMap || typeof fileMap !== 'object' || Array.isArray(fileMap)) {
    throw new TypeError('File map object required');
  }
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('Invalid ZIP write limits');
  }
  if (deflate !== undefined && typeof deflate !== 'function') {
    throw new TypeError('deflate provider must be a function');
  }
  if (!compress) return writeZip(fileMap, { maxFiles, maxBytes });

  const sorted = Object.entries(fileMap)
    .map(([name, data]) => ({ name: nsitePath(name).slice(1), data: bytes(data) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (sorted.length > maxFiles || sorted.length > 65535) throw new RangeError('Too many ZIP entries');

  let nodeDeflateRaw = null;
  const compressBytes = async raw => {
    if (deflate) return bytes(await deflate(raw));
    if (typeof globalThis.CompressionStream === 'function') return streamDeflateRaw(raw);
    if (typeof process !== 'undefined' && process.versions?.node) {
      if (!nodeDeflateRaw) {
        const zlib = await import('node:zlib');
        nodeDeflateRaw = zlib.deflateRawSync;
      }
      return bytes(nodeDeflateRaw(raw));
    }
    return null;
  };

  const used = new Set();
  let cursor = 0;
  let total = 0;
  const sections = [];
  const cent = [];
  const h = size => new Uint8Array(size);
  const put16 = (d, o, v) => new DataView(d.buffer).setUint16(o, v, true);
  const put32 = (d, o, v) => new DataView(d.buffer).setUint32(o, v, true);
  const join = parts => {
    const size = parts.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(size);
    let p = 0;
    for (const a of parts) {
      out.set(a, p);
      p += a.length;
    }
    return out;
  };

  for (const f of sorted) {
    if (used.has(f.name)) throw new Error('Duplicate ZIP path');
    used.add(f.name);
    total += f.data.length;
    if (total > maxBytes) throw new RangeError('ZIP exceeds byte budget');
    const name = encode(f.name);
    const crc = crc32(f.data);
    if (name.length > 65535) throw new RangeError('ZIP name too long');
    if (cursor > 0xffffffff || f.data.length > 0xffffffff) throw new RangeError('ZIP64 size limit exceeded');

    let method = 0;
    let payload = f.data;
    if (f.data.length > 0) {
      const deflated = await compressBytes(f.data);
      if (deflated && deflated.length < f.data.length) {
        method = 8;
        payload = deflated;
      }
    }

    const local = h(30);
    put32(local, 0, 0x04034b50);
    put16(local, 4, 20);
    put16(local, 6, 0x800);
    put16(local, 8, method);
    put32(local, 14, crc);
    put32(local, 18, payload.length);
    put32(local, 22, f.data.length);
    put16(local, 26, name.length);
    sections.push(local, name, payload);

    const central = h(46);
    put32(central, 0, 0x02014b50);
    put16(central, 4, 20);
    put16(central, 6, 20);
    put16(central, 8, 0x800);
    put16(central, 10, method);
    put32(central, 16, crc);
    put32(central, 20, payload.length);
    put32(central, 24, f.data.length);
    put16(central, 28, name.length);
    put32(central, 42, cursor);
    cent.push(central, name);
    cursor += local.length + name.length + payload.length;
  }

  const centralBytes = join(cent);
  if (cursor > 0xffffffff || centralBytes.length > 0xffffffff) throw new RangeError('ZIP64 size limit exceeded');
  const footer = h(22);
  put32(footer, 0, 0x06054b50);
  put16(footer, 8, sorted.length);
  put16(footer, 10, sorted.length);
  put32(footer, 12, centralBytes.length);
  put32(footer, 16, cursor);
  return join([...sections, centralBytes, footer]);
}

