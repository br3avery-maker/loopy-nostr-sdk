// NIP-01 fields are locally checkable; extension predicates such as NIP-50
// search remain relay-defined. A valid signature alone does not prove a match.
export function matchesFilter(event, filter) {
  for (const [key, field] of [['ids', 'id'], ['authors', 'pubkey'], ['kinds', 'kind']]) {
    if (Object.hasOwn(filter, key) && (!Array.isArray(filter[key]) || !filter[key].includes(event[field]))) return false;
  }
  if (Object.hasOwn(filter, 'since') && !(event.created_at >= filter.since)) return false;
  if (Object.hasOwn(filter, 'until') && !(event.created_at <= filter.until)) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (
      /^#[a-zA-Z]$/.test(key) &&
      (!Array.isArray(values) || !event.tags?.some(tag => tag[0] === key[1] && typeof tag[1] === 'string' && values.includes(tag[1])))
    ) {
      return false;
    }
  }
  return true;
}
