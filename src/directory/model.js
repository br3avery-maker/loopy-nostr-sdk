import { endpoint } from '../core/urls.js';
import { isForbiddenKey, isHex, safeHttpUrl } from '../core/guards.js';

export const VERSION = 1;
export const defaultRules = [
  {
    id: 'confirmed-campaign',
    name: 'Confirmed promotional campaign',
    enabled: true,
    match: 'all',
    conditions: [{ field: 'campaign', op: 'equals', value: 'true' }],
  },
];

export function emptyState() {
  return {
    schema: 'nsite-workspace/1',
    edits: Object.create(null),
    groups: [],
    rules: structuredClone(defaultRules),
    preferences: { q: '', sort: 'source', visibility: 'visible', group: '', page: 0 },
    revision: 0,
  };
}

export const safeURL = s => safeHttpUrl(s, { allowHttp: true, maxLength: 4096 }) || '';

export function effective(site, state) {
  const edits = state?.edits;
  const e = edits && !isForbiddenKey(site.id) && Object.hasOwn(edits, site.id) ? edits[site.id] : {};
  return {
    ...site,
    ...e,
    id: site.id,
    original: site.original || site,
    tags: e.tags || site.tags || [],
    groups: e.groups || [],
    notes: e.notes || '',
    hidden: !!e.hidden,
  };
}

export function matches(site, rule) {
  if (!rule.enabled) return false;
  const tests = rule.conditions.map(c => {
    const v = String(site[c.field] ?? '').toLowerCase();
    const x = c.value.toLowerCase();
    return c.op === 'equals' ? v === x : c.op === 'startsWith' ? v.startsWith(x) : v.includes(x);
  });
  return rule.match === 'any' ? tests.some(Boolean) : tests.every(Boolean);
}

export function reasons(site, state) {
  return [...(site.hidden ? ['Manually hidden'] : []), ...state.rules.filter(r => matches(site, r)).map(r => r.name)];
}

export function select(sites, state, p = state.preferences) {
  let out = sites.map(s => effective(s, state));
  const terms = p.q ? p.q.toLowerCase().trim().split(/\s+/).filter(Boolean) : [];
  out = out.filter(s => {
    const hidden = reasons(s, state).length > 0;
    return (
      (p.visibility === 'all' || (p.visibility === 'hidden' ? hidden : !hidden)) &&
      (!p.group || s.groups.includes(p.group)) &&
      (!terms.length ||
        terms.every(q => [s.title, s.description, s.publisher, s.url, s.notes, s.content || '', ...s.tags].join(' ').toLowerCase().includes(q)))
    );
  });
  out.sort(
    p.sort === 'title'
      ? (a, b) => a.title.localeCompare(b.title)
      : p.sort === 'publisher'
        ? (a, b) => a.publisher.localeCompare(b.publisher)
        : p.sort === 'pages'
          ? (a, b) => b.pages - a.pages
          : p.sort === 'edited'
            ? (a, b) => (b.modified || 0) - (a.modified || 0)
            : (a, b) => a.position - b.position
  );
  return out;
}

export function validateRules(value) {
  const rules = Array.isArray(value) ? value : value?.rules;
  if (!Array.isArray(rules) || rules.length > 100) throw new Error('Expected up to 100 filter rules.');
  const fields = ['title', 'description', 'publisher', 'url', 'tags', 'campaign', 'pages', 'pubkey'];
  return rules.map((r, i) => {
    if (
      !r ||
      typeof r.name !== 'string' ||
      !r.name.trim() ||
      !['all', 'any'].includes(r.match) ||
      !Array.isArray(r.conditions) ||
      !r.conditions.length ||
      r.conditions.length > 12
    ) {
      throw new Error(`Rule ${i + 1}: name, match (all/any), and conditions are required.`);
    }
    return {
      id:
        r.id === 'confirmed-campaign' && JSON.stringify(r.conditions) === JSON.stringify(defaultRules[0].conditions)
          ? 'confirmed-campaign'
          : 'import-' + i + '-' + Date.now(),
      name: r.name.slice(0, 150),
      enabled: r.enabled !== false,
      match: r.match,
      conditions: r.conditions.map(c => {
        if (!fields.includes(c.field) || !['equals', 'contains', 'startsWith'].includes(c.op) || typeof c.value !== 'string' || !c.value.trim() || c.value.length > 1000) {
          throw new Error(`Invalid condition in ${r.name}.`);
        }
        return { field: c.field, op: c.op, value: c.value };
      }),
    };
  });
}

export function validateCatalog(value) {
  if (!value || !Array.isArray(value.sites) || value.sites.length > 50000) {
    throw new Error('Expected a catalog with a sites array (maximum 50,000).');
  }
  const seen = new Set();
  return value.sites.map((s, i) => {
    const url = safeURL(s.url);
    if ((!url && !safeURL(s.status)) || typeof s.id !== 'string' || !s.id || s.id.length > 1024 || isForbiddenKey(s.id) || seen.has(s.id)) {
      throw new Error(`Invalid or duplicate site at row ${i + 1}.`);
    }
    seen.add(s.id);
    return {
      id: s.id,
      url,
      title: String(s.title || 'Untitled site').slice(0, 1000),
      description: String(s.description || '').slice(0, 20000),
      publisher: String(s.publisher || '').slice(0, 1000),
      pubkey: String(s.pubkey || '').slice(0, 100),
      pages: Math.max(0, Number(s.pages) || 0),
      position: Number(s.position) || i + 1,
      updated: String(s.updated || ''),
      status: safeURL(s.status),
      campaign: s.campaign === true,
      pattern: String(s.pattern || ''),
      tags: Array.isArray(s.tags) ? s.tags.map(String).slice(0, 100) : [],
      original: s.original || s,
      ...validatedLive(s),
    };
  });
}

export function patch(state, ids, changes) {
  const now = Date.now();
  const safeChanges = {};
  if (changes && typeof changes === 'object') {
    for (const [k, v] of Object.entries(changes)) {
      if (!isForbiddenKey(k)) safeChanges[k] = structuredClone(v);
    }
  }
  for (const id of ids) {
    if (typeof id !== 'string' || !id || isForbiddenKey(id)) continue;
    const prev = Object.hasOwn(state.edits, id) ? state.edits[id] : undefined;
    state.edits[id] = { ...prev, ...structuredClone(safeChanges), modified: now };
  }
  state.revision++;
}

export function bulkGroup(state, ids, group, remove = false) {
  if (typeof group !== 'string' || !group.trim()) throw new Error('Enter a group name.');
  group = group.trim().slice(0, 100);
  if (!remove && !state.groups.includes(group)) state.groups.push(group);
  const now = Date.now();
  for (const id of ids) {
    if (typeof id !== 'string' || !id || isForbiddenKey(id)) continue;
    const prev = Object.hasOwn(state.edits, id) ? state.edits[id] : {};
    const groups = new Set(prev.groups || []);
    remove ? groups.delete(group) : groups.add(group);
    state.edits[id] = { ...prev, groups: [...groups], modified: now };
  }
  state.revision++;
}

export function validateWorkspace(w, sites) {
  if (w?.schema !== 'nsite-workspace/1' || !w.edits || Array.isArray(w.edits) || !Array.isArray(w.groups) || !Array.isArray(w.rules)) {
    throw new Error('Invalid workspace.');
  }
  const allowed = new Set(sites.map(s => s.id).filter(id => typeof id === 'string' && !isForbiddenKey(id)));
  const out = emptyState();
  out.rules = validateRules(w.rules);
  out.groups = w.groups.map(String).slice(0, 1000);
  const p = w.preferences || {};
  out.preferences = {
    q: typeof p.q === 'string' ? p.q.slice(0, 1000) : '',
    sort: Object.keys(SORTS).includes(p.sort) ? p.sort : 'source',
    visibility: ['all', 'visible', 'hidden'].includes(p.visibility) ? p.visibility : 'visible',
    group: out.groups.includes(p.group) ? p.group : '',
    page: Math.max(0, Number(p.page) || 0),
  };
  if (w.publication) {
    out.publication = {
      title: String(w.publication.title || 'Nsite Directory').slice(0, 150),
      description: String(w.publication.description || '').slice(0, 2000),
      group: out.groups.includes(w.publication.group) ? w.publication.group : '',
    };
  }
  for (const [id, e] of Object.entries(w.edits)) {
    if (isForbiddenKey(id) || !allowed.has(id) || !e || typeof e !== 'object') continue;
    const clean = {};
    for (const f of ['title', 'description', 'notes', 'publicScreenshot']) if (typeof e[f] === 'string') clean[f] = e[f].slice(0, 20000);
    for (const f of ['tags', 'groups']) if (Array.isArray(e[f])) clean[f] = e[f].map(String).slice(0, 1000);
    if (typeof e.hidden === 'boolean') clean.hidden = e.hidden;
    if (typeof e.reviewed === 'boolean') clean.reviewed = e.reviewed;
    clean.modified = Number(e.modified) || 0;
    out.edits[id] = clean;
  }
  out.preferences = {
    ...out.preferences,
    direction: p.direction === 'desc' ? 'desc' : 'asc',
    publisher: typeof p.publisher === 'string' ? p.publisher : '',
    curation: ['all', 'unstacked', 'stacked', 'uncollected', 'unedited', 'missing', 'reviewed', 'unreviewed'].includes(p.curation)
      ? p.curation
      : 'all',
  };
  const used = new Set();
  out.stacks = (Array.isArray(w.stacks) ? w.stacks : [])
    .slice(0, 25000)
    .map((s, i) => {
      const members = [...new Set(Array.isArray(s.members) ? s.members : [])].filter(id => allowed.has(id) && !used.has(id));
      members.forEach(id => used.add(id));
      return {
        id: 'restored-stack-' + i,
        members,
        primary: members.includes(s.primary) ? s.primary : members[0],
        title: String(s.title || '').slice(0, 1000),
        description: String(s.description || '').slice(0, 20000),
      };
    })
    .filter(s => s.members.length > 1);
  out.queue = {
    ids: [...new Set(w.queue?.ids || [])].filter(id => allowed.has(id)),
    index: Math.max(0, Math.min(Number(w.queue?.index) || 0, (w.queue?.ids?.length || 1) - 1)),
  };
  out.screenshots = Object.create(null);
  let imageBytes = 0;
  for (const [id, shots] of Object.entries(w.screenshots || {})) {
    if (isForbiddenKey(id) || !allowed.has(id) || !Array.isArray(shots)) continue;
    out.screenshots[id] = shots
      .filter(s => safeImage(s.data))
      .slice(0, 20)
      .map(s => {
        imageBytes += s.data.length;
        if (imageBytes > 25000000) throw new Error('Screenshot attachments exceed the 25 MB backup limit.');
        return { id: String(s.id).slice(0, 100), data: s.data, created: Number(s.created) || 0, source: String(s.source || 'imported').slice(0, 30) };
      });
  }
  out.separateCopies = (w.separateCopies || []).filter(id => allowed.has(id));
  if (w.live && typeof w.live === 'object') {
    const validRelays = [];
    for (const x of Array.isArray(w.live.relays) ? w.live.relays : []) {
      if (typeof x !== 'string') continue;
      try {
        const canonical = endpoint(x, 'relay');
        if (!validRelays.includes(canonical)) validRelays.push(canonical);
      } catch {}
      if (validRelays.length >= 12) break;
    }
    out.live = {
      enabled: w.live.enabled !== false,
      autoStack: w.live.autoStack !== false,
      relays: validRelays,
      cursors: {},
    };
  }
  return upgrade(out);
}

export function exportCatalog(sites, state) {
  return { schema: 'nsite-directory-backup/1', exportedAt: new Date().toISOString(), sites, workspace: state };
}

export function publicCatalog(sites, state, group = '') {
  return select(sites, state, { q: '', sort: 'title', visibility: 'visible', group }).map(s => {
    const shots = state.screenshots && Object.hasOwn(state.screenshots, s.id) ? state.screenshots[s.id] : undefined;
    const edit = state.edits && Object.hasOwn(state.edits, s.id) ? state.edits[s.id] : undefined;
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      publisher: s.publisher,
      url: safeURL(s.url),
      status: safeURL(s.status),
      pages: s.pages,
      tags: s.tags,
      groups: s.groups,
      position: s.position,
      updated: s.updated,
      screenshot: safeImage(shots?.find(x => x.id === edit?.publicScreenshot)?.data),
      stack:
        (state.stacks || [])
          .filter(t => t.members.includes(s.id))
          .map(t => ({ id: t.id, title: t.title, description: t.description, primary: t.primary }))[0] || null,
    };
  });
}

// Copy/clone stacks are independent of the existing collection memberships.
export const SORTS = {
  publisherCount: 'Publisher · number of sites',
  publisher: 'Publisher name',
  title: 'Title',
  similar: 'Similar titles / descriptions',
  pages: 'Page count',
  copies: 'Copies per stack',
  missing: 'Missing metadata',
  updated: 'Source update time',
  edited: 'Last edited',
  source: 'Source order',
};

export function upgrade(state) {
  state.stacks ??= [];
  state.queue ??= { ids: [], index: 0 };
  state.preferences ??= {};
  for (const [k, v] of Object.entries({ direction: 'asc', curation: 'all', publisher: '' })) {
    if (state.preferences[k] === undefined) state.preferences[k] = v;
  }
  return state;
}

export function publisherKey(s) {
  return s.pubkey || s.publisher || 'Unknown publisher';
}

export function publisherCounts(sites, state) {
  const counts = new Map();
  for (const raw of sites) {
    const s = effective(raw, state);
    if (!reasons(s, state).length) {
      const k = publisherKey(s);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return counts;
}

export function membership(state) {
  const map = new Map();
  for (const stack of state.stacks || []) for (const id of stack.members) map.set(id, stack);
  return map;
}

export function toggleState(values) {
  return values.every(Boolean) ? 'on' : values.some(Boolean) ? 'mixed' : 'off';
}

export function groupState(state, ids) {
  const map = membership(state);
  const first = map.get(ids[0]);
  return first && ids.every(id => map.get(id)?.id === first.id) ? 'on' : ids.some(id => map.has(id)) ? 'mixed' : 'off';
}

export function unstack(state, ids, remember = true) {
  if (remember) state.separateCopies = [...new Set([...(state.separateCopies || []), ...ids])];
  const selected = new Set(ids);
  state.stacks = (state.stacks || []).map(s => ({ ...s, members: s.members.filter(id => !selected.has(id)) })).filter(s => s.members.length > 1);
  state.revision++;
}

export function stackSites(state, ids, { title = '', description = '' } = {}) {
  ids = [...new Set(ids)];
  if (ids.length < 2) throw new Error('Select at least two sites to stack.');
  unstack(state, ids, false);
  state.separateCopies = (state.separateCopies || []).filter(id => !ids.includes(id));
  const stack = {
    id: 'stack-' + Date.now().toString(36) + '-' + state.revision++,
    members: ids,
    primary: ids[0],
    title: title.trim(),
    description: description.trim(),
  };
  state.stacks.push(stack);
  return stack;
}

export function ageSeconds(value) {
  const m = /^(\d+)\s*(s|m|h|d|w|mo|y)\s+ago$/.exec(value || '');
  return m ? +m[1] * { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, y: 31536000 }[m[2]] : null;
}

export function similarityKey(s) {
  return String(s.description || s.title || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function directoryRows(sites, state, p = state.preferences) {
  upgrade(state);
  const stackMap = membership(state);
  const all = new Map();
  const hiddenById = new Map();
  const counts = new Map();
  for (const raw of sites) {
    const eff = effective(raw, state);
    all.set(raw.id, eff);
    const isHidden = reasons(eff, state).length > 0;
    hiddenById.set(raw.id, isHidden);
    if (!isHidden) {
      const k = publisherKey(eff);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const terms = p.q ? p.q.toLowerCase().trim().split(/\s+/).filter(Boolean) : [];
  const rows = [...all.values()]
    .filter(s => {
      const isHidden = hiddenById.get(s.id);
      if (!(p.visibility === 'all' || (p.visibility === 'hidden' ? isHidden : !isHidden))) return false;
      if (p.group && !s.groups.includes(p.group)) return false;
      if (
        terms.length &&
        !terms.every(q =>
          [
            s.title,
            s.description,
            s.publisher,
            s.url,
            s.notes,
            s.content || '',
            ...s.tags,
            stackMap.get(s.id)?.title || '',
            stackMap.get(s.id)?.description || '',
          ]
            .join(' ')
            .toLowerCase()
            .includes(q)
        )
      ) {
        return false;
      }
      if (p.publisher && publisherKey(s) !== p.publisher) return false;
      if (p.curation === 'unstacked' && stackMap.has(s.id)) return false;
      if (p.curation === 'stacked' && !stackMap.has(s.id)) return false;
      if (p.curation === 'uncollected' && s.groups.length) return false;
      if (p.curation === 'unedited' && Object.hasOwn(state.edits, s.id)) return false;
      if (p.curation === 'reviewed' && !s.reviewed) return false;
      if (p.curation === 'unreviewed' && s.reviewed) return false;
      if (p.curation === 'missing' && s.description && s.title && !s.title.includes('.nsite.')) return false;
      return true;
    })
    .sort((a, b) => a.position - b.position);

  const seen = new Set();
  const output = [];
  for (const s of rows) {
    const stack = stackMap.get(s.id);
    if (stack) {
      if (seen.has(stack.id)) continue;
      seen.add(stack.id);
      const members = stack.members
        .map(id => all.get(id))
        .filter(x => x && (p.visibility === 'all' || (p.visibility === 'hidden' ? hiddenById.get(x.id) : !hiddenById.get(x.id))));
      if (!members.length) continue;
      const primary = members.find(x => x.id === stack.primary) || members[0];
      output.push({
        ...primary,
        title: stack.title || primary.title,
        description: stack.description || primary.description,
        stack,
        members,
        copies: members.length,
      });
    } else {
      output.push({ ...s, members: [s], copies: 1 });
    }
  }

  // Precompute similarity keys once (Schwartzian transform) when sorting by 'similar'.
  const simKeys = p.sort === 'similar' ? new Map(output.map(r => [r, similarityKey(r)])) : null;
  const compare = (a, b) => {
    let av, bv;
    switch (p.sort) {
      case 'publisherCount':
        av = counts.get(publisherKey(a)) || 0;
        bv = counts.get(publisherKey(b)) || 0;
        break;
      case 'publisher':
        return a.publisher.localeCompare(b.publisher) || a.title.localeCompare(b.title);
      case 'title':
        return a.title.localeCompare(b.title);
      case 'similar':
        return simKeys.get(a).localeCompare(simKeys.get(b)) || a.title.localeCompare(b.title);
      case 'pages':
        av = a.pages;
        bv = b.pages;
        break;
      case 'copies':
        av = a.copies;
        bv = b.copies;
        break;
      case 'missing':
        av = Number(!a.description) + Number(!a.title || a.title.includes('.nsite.'));
        bv = Number(!b.description) + Number(!b.title || b.title.includes('.nsite.'));
        break;
      case 'updated':
        av = a.created_at || null;
        bv = b.created_at || null;
        if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
        break;
      case 'edited':
        av = a.modified || 0;
        bv = b.modified || 0;
        break;
      default:
        av = a.position;
        bv = b.position;
    }
    return av - bv || a.position - b.position;
  };
  output.sort((a, b) => {
    if (p.sort === 'updated' && (!a.created_at || !b.created_at)) return compare(a, b);
    return (p.direction === 'desc' ? -1 : 1) * compare(a, b);
  });
  return output.map(s => ({ ...s, publisherCount: counts.get(publisherKey(s)) || 0 }));
}

export function setQueue(state, ids, append = false) {
  upgrade(state);
  const cleanIds = (Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && !isForbiddenKey(id));
  state.queue = { ids: [...new Set(append ? [...state.queue.ids, ...cleanIds] : cleanIds)], index: append ? state.queue.index : 0 };
  state.revision++;
}

export function moveQueue(state, delta) {
  upgrade(state);
  state.queue.index = Math.max(0, Math.min(state.queue.ids.length - 1, state.queue.index + delta));
  return state.queue.ids[state.queue.index];
}

export function safeImage(value) {
  return typeof value === 'string' && value.length < 4000000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
    ? value
    : '';
}

function validatedLive(s) {
  const out = {};
  if (s.live === true) out.live = true;
  for (const k of ['created_at', 'indexedAt', 'nextIndexAt', 'fileCount']) if (Number.isFinite(s[k])) out[k] = Math.max(0, s[k]);
  for (const k of ['manifestId', 'aggregate', 'indexHash']) if (isHex(s[k], 64)) out[k] = s[k];
  for (const k of ['indexPath', 'content', 'metadataSource', 'indexError']) if (typeof s[k] === 'string') out[k] = s[k].slice(0, 12000);
  for (const [k, kind] of [['servers', 'blossom'], ['relays', 'relay']]) {
    if (Array.isArray(s[k])) {
      const valid = [];
      for (const x of s[k]) {
        if (typeof x !== 'string') continue;
        try {
          const canonical = endpoint(x, kind);
          if (!valid.includes(canonical)) valid.push(canonical);
        } catch {}
        if (valid.length >= 20) break;
      }
      out[k] = valid;
    }
  }
  if (Array.isArray(s.versions)) {
    out.versions = s.versions
      .filter(v => v && isHex(v.id, 64) && Number.isFinite(v.created_at))
      .slice(0, 100)
      .map(v => ({
        id: v.id,
        created_at: v.created_at,
        aggregate: String(v.aggregate || '').slice(0, 64),
        pages: Math.max(0, Number(v.pages) || 0),
      }));
  }
  return out;
}
