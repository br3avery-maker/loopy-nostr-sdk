import { eventTemplate, checkedSign, assertSignedEvent } from './events.js';
import { publishMany, queryRelay } from './relay-transport.js';
import { verifiedReceipts } from './receipts.js';
import { verifiedCopy } from './history.js';
import { endpoints } from '../core/urls.js';
import { assertHex, assertSafeInt, isHex } from '../core/guards.js';

/** Kind 1 text note. Reply carries both parent event and author's pubkey. */
export function textNote(content, { replyTo, created_at = Math.floor(Date.now() / 1000) } = {}) {
  if (typeof content !== 'string' || content.length > 16000) throw new TypeError('Text note must be a string <= 16k characters');
  const tags = [];
  if (replyTo !== undefined && replyTo !== null) {
    assertHex(replyTo?.id, 64, 'replyTo.id');
    tags.push(['e', replyTo.id, '', 'reply']);
    if (replyTo.pubkey !== undefined && replyTo.pubkey !== '') {
      assertHex(replyTo.pubkey, 64, 'replyTo.pubkey');
      tags.push(['p', replyTo.pubkey]);
    }
  }
  return eventTemplate({ kind: 1, content, tags, created_at });
}

export function reaction(target, emoji = '+', { created_at = Math.floor(Date.now() / 1000) } = {}) {
  if (!isHex(target?.id, 64) || !isHex(target?.pubkey, 64)) throw new TypeError('Signed target event id and pubkey required');
  return eventTemplate({ kind: 7, content: String(emoji), tags: [['e', target.id], ['p', target.pubkey]], created_at });
}

export async function publishTemplate(template, { signer, pubkey, relays, publisher = publishMany, signal, timeoutMs, Socket, authSigner, authPubkey, requireAuthentication } = {}) {
  if (!signer || !isHex(pubkey, 64)) throw new Error('Approved signer and author required');
  const destinations = endpoints(relays, 'relay', 16);
  if (!destinations.length) throw new Error('At least one relay required');
  const signed = verifiedCopy(await checkedSign(signer, template, pubkey));
  const pubOpts = {};
  if (signal !== undefined) pubOpts.signal = signal;
  if (timeoutMs !== undefined) pubOpts.timeoutMs = timeoutMs;
  if (Socket !== undefined) pubOpts.Socket = Socket;
  if (authSigner !== undefined) pubOpts.authSigner = authSigner;
  if (authPubkey !== undefined) pubOpts.authPubkey = authPubkey;
  if (requireAuthentication !== undefined) pubOpts.requireAuthentication = requireAuthentication;
  const receipts = Object.keys(pubOpts).length
    ? await publisher(structuredClone(signed), [...destinations], pubOpts)
    : await publisher(structuredClone(signed), [...destinations]);
  const verified = verifiedReceipts(receipts, signed.id, destinations);
  if (!verified.length) throw new Error('No verified relay readback for signed note');
  return { event: signed, receipts: { ...receipts, verified } };
}

export async function fetchFeed({ authors = [], kinds = [1, 7], relays = [], limit = 100, query = queryRelay, signal, timeoutMs, Socket } = {}) {
  if (!Array.isArray(authors) || !authors.length) throw new Error('Provide at least one author pubkey');
  const cleanAuthors = [...new Set(authors)];
  if (cleanAuthors.some(a => !isHex(a, 64))) throw new TypeError('Expected hex author pubkeys');
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(k => !Number.isSafeInteger(k) || k < 0 || k > 65535)) {
    throw new TypeError('Expected valid event kinds');
  }
  const boundedLimit = assertSafeInt(limit, { min: 1, max: 500, label: 'limit' });
  const filter = { authors: cleanAuthors, kinds: [...new Set(kinds)], limit: boundedLimit };
  const urls = endpoints(relays, 'relay', 24);
  const seen = new Map(), fail = [];
  const transportOpts = (signal !== undefined || timeoutMs !== undefined || Socket !== undefined)
    ? { ...(signal !== undefined ? { signal } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(Socket !== undefined ? { Socket } : {}) }
    : undefined;

  const results = await Promise.allSettled(
    urls.map(url => (transportOpts ? query(url, filter, transportOpts) : query(url, filter)))
  );
  if (signal?.aborted) throw new Error('Feed retrieval cancelled');
  let succeeded = false;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      fail.push({ relay: urls[i], error: String(r.reason?.message || r.reason) });
      continue;
    }
    if (!Array.isArray(r.value)) {
      fail.push({ relay: urls[i], error: 'Malformed relay result' });
      continue;
    }
    succeeded = true;
    for (const event of r.value) {
      try {
        assertSignedEvent(event);
        if (cleanAuthors.includes(event.pubkey) && filter.kinds.includes(event.kind)) seen.set(event.id, event);
      } catch {}
    }
  }
  return {
    events: [...seen.values()].sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(0, boundedLimit),
    failed: fail,
    status: succeeded ? 'queried' : 'unreachable',
  };
}
