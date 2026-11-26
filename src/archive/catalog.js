/** Recovery archive catalog: bounded index, version lineage, and clone-aware search. */
export function buildArchiveCatalog(versions, { pages = [], jobs = [], settings = [] } = {}) {
  if (!Array.isArray(versions)) throw new TypeError('Versions array required');
  const bySite = new Map();
  const pageMap = new Map(pages.map(p => [`${p.hash}\n${p.path}`, p]));
  const jobsByHash = new Map(jobs.map(j => [j.hash || j.id, j]));
  const preferences = new Map(settings.map(s => [s.id, s]));
  const seenBySite = new Map();
  for (const v of versions) {
    if (!v || typeof v.site !== 'string' || !v.event) continue;
    let group = bySite.get(v.site);
    let seenIds = seenBySite.get(v.site);
    if (!group) {
      group = [];
      seenIds = new Set();
      bySite.set(v.site, group);
      seenBySite.set(v.site, seenIds);
    }
    const eid = typeof v.event.id === 'string' && v.event.id ? v.event.id : null;
    if (eid) {
      if (seenIds.has(eid)) continue;
      seenIds.add(eid);
    }
    group.push(v);
  }
  const sites = [];
  for (const [id, list] of bySite) {
    list.sort((a, b) => (b.event?.created_at || 0) - (a.event?.created_at || 0) || String(a.id ?? a.event?.id ?? '').localeCompare(String(b.id ?? b.event?.id ?? '')));
    const latest = list[0];
    const files = latest.files || [];
    const derived = files.map(f => pageMap.get(`${f.hash}\n${f.path}`)).filter(Boolean);
    const title = latest.published?.title || derived.find(p => p.data?.title)?.data.title || 'Untitled site';
    const description = latest.published?.description || derived.find(p => p.data?.description)?.data.description || '';
    sites.push({
      id,
      publisher: latest.event.pubkey,
      title,
      description,
      created: latest.event.created_at,
      versions: list.length,
      files: files.length,
      verifiedFiles: files.filter(f => jobsByHash.get(f.hash)?.state === 'complete').length,
      hidden: !!preferences.get('hidden:' + id)?.hidden,
      search: [id, title, description, latest.event.pubkey, ...derived.map(x => x.data?.text || '')].join(' ').toLowerCase(),
    });
  }
  return { bySite, sites };
}

export function searchArchive(catalog, { query = '', publisher = '', sort = 'recent', offset = 0, limit = 40, includeHidden = false } = {}) {
  const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 40;
  const terms = String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
  const all = (catalog?.sites || []).filter(
    s => (includeHidden || !s.hidden) && (!publisher || s.publisher === publisher) && terms.every(q => s.search.includes(q))
  );
  all.sort(
    sort === 'title'
      ? (a, b) => a.title.localeCompare(b.title)
      : sort === 'files'
        ? (a, b) => b.files - a.files
        : (a, b) => b.created - a.created
  );
  return { total: all.length, rows: all.slice(safeOffset, safeOffset + safeLimit).map(({ search, ...s }) => s) };
}
