import { endpoint } from '../core/urls.js';

function canonicalRelay(value) {
  try { return endpoint(value, 'relay'); } catch { return value; }
}

/** Validate assertions from a trusted injected transport; this is not independent network verification. */
export function isVerifiedReceipt(receipt, eventId, relay) {
  return receipt?.accepted === true && receipt.readback === true && receipt.eventId === eventId && canonicalRelay(receipt.relay) === canonicalRelay(relay);
}

export function verifiedReceipts(receipts, eventId, relays) {
  const allowed = new Set((Array.isArray(relays) ? relays : []).map(canonicalRelay));
  const found = new Map();
  for (const r of Array.isArray(receipts?.verified) ? receipts.verified : []) {
    const relay = canonicalRelay(r?.relay);
    if (allowed.has(relay) && isVerifiedReceipt(r, eventId, relay)) {
      const entry = { relay, eventId, accepted: true, readback: true };
      if (r.authenticated === true) entry.authenticated = true;
      found.set(relay, entry);
    }
  }
  return [...found.values()];
}
