/** Exact gear-v1-16k-64k-256k boundary profile from Pretend Internet nsite archive.
 * NOT Hashtree serialization or Blossom's whole-file hash.
 */
export const GEAR_PROFILE = Object.freeze({ id: 'gear-v1-16k-64k-256k', min: 16384, avg: 65536, max: 262144 });
const GEAR = Uint32Array.from([3810622357, 4086661038, 4061059927, 945727656, 3789942674, 472720042, 387097884, 733793806, 3679839176, 2980992546, 434350497, 3696926428, 1356687297, 2665011189, 1646650326, 3769252038, 1906933907, 2710543077, 3072133680, 3461411027, 2810333575, 810636265, 714141688, 3019746126, 519246716, 3360912564, 622576373, 1331254994, 3738644857, 982828786, 3129278250, 3225764230, 3924505147, 2314912782, 2347871360, 2498322774, 1174396302, 389175704, 4129783515, 2973284295, 2471998037, 3737135771, 29046380, 1841822665, 2042515314, 1079256972, 547942395, 648246921, 454071953, 2614815546, 3642999078, 1302903179, 906019210, 4288935060, 674512160, 3592301196, 2612658663, 2749648915, 2535969231, 1722207646, 3261237095, 155825753, 1908144769, 3187011251, 3536592821, 49545620, 4020202696, 3313178010, 751338088, 651685070, 430982662, 446258111, 3089400799, 2115266673, 3339916966, 2575553824, 860094223, 3260865884, 2079559864, 27253461, 3358125929, 982018607, 1155173523, 472897939, 756186727, 1662057282, 3999236450, 2313587305, 1863420652, 3218534482, 3313928984, 3833736078, 4186846003, 51533914, 812556357, 2258347875, 1083616516, 1738433325, 73007606, 3247986161, 1754782784, 3251272253, 182312114, 3693399240, 2337621670, 1239680176, 1270057413, 3551293391, 54972456, 2208720579, 3224895662, 554541173, 2539980735, 2423740669, 4236650137, 2983749349, 1523030015, 4220344481, 2288767667, 2063314939, 2390535239, 1729915678, 3127266895, 3592430730, 1578561167, 625470724, 1371514724, 2177433297, 697604782, 3652798257, 2931585512, 943652161, 444994953, 1323647619, 2909159975, 2546485840, 2153999814, 1585340442, 2131984309, 440795905, 3363036269, 399235882, 1761102856, 1518448186, 429138795, 3590807561, 500797547, 3973241347, 1982110550, 3516682352, 561588652, 2556776811, 3564000881, 1224316791, 2630335031, 3002107737, 806724252, 3454749351, 1991776854, 1082106858, 1280002066, 1824739306, 882819209, 808092485, 3900682169, 369920689, 786488811, 3254052586, 2403851804, 2468118394, 2437093291, 4087504381, 2422701125, 2960935387, 469895564, 3989075425, 2099043371, 1832648466, 3133724456, 3618844275, 258533551, 951268370, 2636394710, 1428781272, 3215646046, 3460044863, 3409759303, 107992306, 3342248324, 3249724513, 1911854569, 1975028616, 2120879465, 48447716, 246920488, 2873914066, 2419498304, 388264135, 265165105, 811583477, 150153134, 3395178482, 2667897355, 2190395285, 3152379712, 72269996, 3006909721, 3633678241, 597648884, 2791566530, 1744239910, 2453151232, 2338939699, 2903582742, 2717096080, 3968998293, 1621122596, 1784969599, 3121200395, 3962411950, 449059677, 3476157316, 3298370373, 4046790757, 551678029, 1911656480, 2529805590, 2914590299, 1884911445, 2337404127, 790221064, 875586215, 501828328, 1910520814, 1936715481, 3204967855, 2713268935, 4082338684, 4015578713, 4037194113, 2875414339, 2326700154, 1822625146, 1357061674, 3336000390, 2346155113, 3254234211, 3746944486, 3715906601, 1979556923, 2579170100, 2528060035, 1559886722, 3534896521, 3280181650, 2121927066]);

/** Return zero-copy content-defined partitions; caller retains the original Uint8Array. */
export function gearChunks(data) {
  if (!(data instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
  const out = [];
  let start = 0;
  let roll = 0;
  for (let i = 0; i < data.length; i++) {
    roll = ((roll << 1) + GEAR[data[i]]) >>> 0;
    const size = i - start + 1;
    if (size >= GEAR_PROFILE.min && ((roll & (GEAR_PROFILE.avg - 1)) === 0 || size >= GEAR_PROFILE.max)) {
      out.push(data.subarray(start, i + 1));
      start = i + 1;
      roll = 0;
    }
  }
  if (start < data.length || data.length === 0) out.push(data.subarray(start));
  return out;
}

export async function chunkManifest(data, { hash } = {}) {
  if (!(data instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
  if (typeof hash !== 'function') {
    const { sha256 } = await import('../core/bytes.js');
    hash = sha256;
  }
  const parts = gearChunks(data);
  const chunks = [];
  for (const p of parts) chunks.push({ hash: await hash(p), size: p.length });
  return { profile: GEAR_PROFILE.id, size: data.length, hash: await hash(data), chunks };
}

export async function restoreChunkManifest(manifest, read, { hash, maxBytes = 1000000000, maxChunks = 100000 } = {}) {
  if (
    manifest?.profile !== GEAR_PROFILE.id ||
    !Array.isArray(manifest.chunks) ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size < 0
  ) {
    throw new Error('Unsupported chunk manifest');
  }
  if (typeof read !== 'function') throw new TypeError('Chunk reader required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxChunks) || maxChunks < 0) {
    throw new RangeError('Invalid chunk restoration limits');
  }
  if (typeof hash !== 'function') {
    const { sha256 } = await import('../core/bytes.js');
    hash = sha256;
  }
  if (manifest.size > maxBytes || manifest.chunks.length > maxChunks) throw new Error('Chunk budget exceeded');
  const output = new Uint8Array(manifest.size);
  let pos = 0;
  for (const c of manifest.chunks) {
    if (!c || typeof c.hash !== 'string' || !c.hash || !Number.isSafeInteger(c.size) || c.size < 0 || pos + c.size > output.length) {
      throw new Error('Missing or invalid chunk');
    }
    const part = await read(c.hash);
    if (!(part instanceof Uint8Array) || part.length !== c.size || (await hash(part)) !== c.hash) {
      throw new Error('Missing or invalid chunk');
    }
    output.set(part, pos);
    pos += part.length;
  }
  if (pos !== manifest.size || (await hash(output)) !== manifest.hash) throw new Error('Restored file hash mismatch');
  return output;
}
