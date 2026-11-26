import { BunkerSigner, createNostrConnectURI, generateSecretKey, getPublicKey, parseBunkerInput } from '../../vendor/nostr.js';
import { endpoints } from '../core/urls.js';
import { isHex, assertHex } from '../core/guards.js';
import { checkedSign } from './events.js';

/** Offline parser for bunker:// URIs; never fires an unguarded pre-connect NIP-05 fetch. */
function parseBunkerUriOffline(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('bunker://')) return null;
  let parsed;
  try { parsed = new URL(uri); } catch { return null; }
  const pubkey = (parsed.hostname || parsed.pathname.replace(/^\/+/, '')).toLowerCase();
  if (!isHex(pubkey, 64)) return null;
  const rawRelays = parsed.searchParams.getAll('relay');
  if (!rawRelays.length) return null;
  let relays;
  try { relays = endpoints(rawRelays, 'relay', 16); } catch { return null; }
  if (!relays.length) return null;
  const secret = parsed.searchParams.get('secret') || null;
  return { pubkey, relays, secret };
}

/** Uniform cancellation-safe lifecycle wrapper for NIP-46 remote signers. */
function wrapRemoteSigner(createSigner, { preconnected = null } = {}) {
  let signer = preconnected;
  let pending = null;
  let connected = Boolean(preconnected);
  let closed = false;
  const operations = new Set();

  const cancellable = fn => {
    if (closed) return Promise.reject(new Error('NIP-46 signer closed'));
    let cancel;
    const stopped = new Promise((_, reject) => { cancel = () => reject(new Error('NIP-46 signer closed')); });
    operations.add(cancel);
    const work = Promise.resolve().then(() => {
      if (closed) throw new Error('NIP-46 signer closed');
      return fn();
    });
    return Promise.race([work, stopped]).finally(() => operations.delete(cancel));
  };

  const requireConnected = () => {
    if (!connected || !signer || closed) throw new Error('NIP-46 signer not connected');
    return signer;
  };

  const validatedKey = async active => {
    const key = await active.getPublicKey();
    if (!isHex(key, 64)) throw new Error('Invalid public key from NIP-46 signer');
    return key;
  };

  const api = {
    mode: 'nip46',
    getPublicKey: async () => cancellable(() => validatedKey(requireConnected())),
    signEvent: async template => cancellable(() => requireConnected().signEvent(template)),
    ping: async () =>
      cancellable(async () => {
        const active = requireConnected();
        if (typeof active.ping === 'function') return active.ping();
        await validatedKey(active);
        return 'pong';
      }),
    nip44: {
      encrypt: async (peer, plaintext) => {
        assertHex(peer, 64, 'peer pubkey');
        return cancellable(() => {
          const active = requireConnected();
          if (typeof active.nip44Encrypt !== 'function') throw new Error('NIP-46 signer does not support nip44Encrypt');
          return active.nip44Encrypt(peer, String(plaintext));
        });
      },
      decrypt: async (peer, ciphertext) => {
        assertHex(peer, 64, 'peer pubkey');
        return cancellable(() => {
          const active = requireConnected();
          if (typeof active.nip44Decrypt !== 'function') throw new Error('NIP-46 signer does not support nip44Decrypt');
          return active.nip44Decrypt(peer, String(ciphertext));
        });
      },
    },
    async close() {
      closed = true;
      connected = false;
      const active = signer;
      signer = null;
      for (const cancel of operations) cancel();
      operations.clear();
      if (active && typeof active.close === 'function') await active.close();
    },
  };

  if (createSigner) {
    api.connect = async () => {
      if (closed) throw new Error('NIP-46 signer closed');
      if (connected) return cancellable(() => validatedKey(requireConnected()));
      if (pending) return pending;
      const attempt = createSigner();
      signer = attempt;
      pending = (async () => {
        try {
          await cancellable(() => attempt.connect());
          if (closed || signer !== attempt) throw new Error('NIP-46 signer closed');
          const key = await cancellable(() => validatedKey(attempt));
          if (closed || signer !== attempt) throw new Error('NIP-46 signer closed');
          connected = true;
          return key;
        } catch (e) {
          if (signer === attempt) {
            signer = null;
            connected = false;
            try { await attempt.close(); } catch {}
          }
          throw e;
        } finally {
          pending = null;
        }
      })();
      return pending;
    };
  }

  return api;
}

/** Browser NIP-07 adapter. No private keys stored. Forwards approved nip44 when provided. */
export function browserSigner(provider = globalThis.window?.nostr) {
  if (!provider || typeof provider.getPublicKey !== 'function' || typeof provider.signEvent !== 'function') {
    throw new Error('No NIP-07 browser signer available');
  }
  const adapter = {
    mode: 'nip07',
    getPublicKey: () => provider.getPublicKey(),
    signEvent: e => provider.signEvent(e),
  };
  if (typeof provider.nip44?.encrypt === 'function' && typeof provider.nip44?.decrypt === 'function') {
    adapter.nip44 = {
      encrypt: (peer, plaintext) => provider.nip44.encrypt(peer, plaintext),
      decrypt: (peer, ciphertext) => provider.nip44.decrypt(peer, ciphertext),
    };
  }
  return adapter;
}

/** Use a signer-provided bunker:// URI. Parses strictly offline; does not connect until connect() is called. */
export async function bunkerSigner(uri, { clientSecret = generateSecretKey(), connectOptions = {}, allowNip05Lookup = false } = {}) {
  let pointer = parseBunkerUriOffline(uri);
  if (!pointer && allowNip05Lookup) {
    const resolved = await parseBunkerInput(uri);
    if (resolved && isHex(resolved.pubkey, 64) && Array.isArray(resolved.relays) && resolved.relays.length) {
      pointer = { ...resolved, relays: endpoints(resolved.relays, 'relay', 16) };
    }
  }
  if (!pointer) throw new TypeError('Invalid NIP-46 bunker URI');
  return wrapRemoteSigner(() => {
    const instance = BunkerSigner.fromBunker(clientSecret, pointer);
    return {
      connect: () => instance.connect(connectOptions),
      getPublicKey: () => instance.getPublicKey(),
      signEvent: template => instance.signEvent(template),
      nip44Encrypt: typeof instance.nip44Encrypt === 'function' ? (p, t) => instance.nip44Encrypt(p, t) : undefined,
      nip44Decrypt: typeof instance.nip44Decrypt === 'function' ? (p, c) => instance.nip44Decrypt(p, c) : undefined,
      close: () => instance.close(),
    };
  });
}

/** Copy-to-signer NIP-46 request. start() begins listening before the user switches apps. */
export function nostrConnectRequest({
  relays,
  name = 'Nsite Loopy SDK',
  perms = ['get_public_key', 'sign_event'],
  secret,
  clientSecret = generateSecretKey(),
} = {}) {
  const validRelays = endpoints(relays, 'relay', 16);
  if (!validRelays.length) throw new TypeError('NIP-46 transport relays required');
  const nonce = secret || Array.from(crypto.getRandomValues(new Uint8Array(20)), b => b.toString(16).padStart(2, '0')).join('');
  const uri = createNostrConnectURI({ clientPubkey: getPublicKey(clientSecret), relays: validRelays, secret: nonce, name, perms });
  return {
    uri,
    mode: 'nip46',
    start: async signal => {
      const remote = await BunkerSigner.fromURI(clientSecret, uri, {}, signal);
      return wrapRemoteSigner(null, { preconnected: remote });
    },
  };
}

export async function connectIdentity(signer) {
  const pubkey = await signer.getPublicKey();
  if (!isHex(pubkey, 64)) throw new Error('Invalid public key from signer');
  return { pubkey, signer };
}

/**
 * Create a secret-free, serializable NIP-46 bunker session descriptor.
 * Never includes `clientSecret` or `bunker://` pairing secret; hosts persist the
 * transport secret separately in their secure vault keyed by `clientPubkey`.
 */
export function createBunkerSessionDescriptor({
  remotePubkey,
  userPubkey,
  relays,
  clientPubkey,
  permissions = [],
  createdAt = Math.floor(Date.now() / 1000),
} = {}) {
  if (!isHex(remotePubkey, 64)) throw new TypeError('Valid 64-hex remotePubkey required');
  if (userPubkey !== undefined && !isHex(userPubkey, 64)) throw new TypeError('Valid 64-hex userPubkey required when provided');
  if (!isHex(clientPubkey, 64)) throw new TypeError('Valid 64-hex clientPubkey required');
  const validRelays = endpoints(relays, 'relay', 16);
  if (!validRelays.length) throw new TypeError('At least one valid NIP-46 relay required');
  if (!Array.isArray(permissions) || permissions.some(p => typeof p !== 'string' || !p.trim())) {
    throw new TypeError('permissions must be an array of non-empty strings');
  }
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new RangeError('Invalid createdAt timestamp');
  return {
    schema: 'nip46-bunker-session/1',
    remotePubkey,
    ...(userPubkey ? { userPubkey } : {}),
    clientPubkey,
    relays: validRelays,
    permissions: [...new Set(permissions)],
    createdAt,
  };
}

/**
 * Restore a NIP-46 bunker signer from a secret-free session descriptor by loading
 * the transport secret on demand from the host application's vault callback.
 */
export async function restoreBunkerSigner(
  descriptor,
  { loadClientSecret, connectOptions = {}, createTransport } = {}
) {
  if (!descriptor || descriptor.schema !== 'nip46-bunker-session/1') {
    throw new TypeError('Valid nip46-bunker-session/1 descriptor required');
  }
  if (!isHex(descriptor.remotePubkey, 64) || !isHex(descriptor.clientPubkey, 64)) {
    throw new TypeError('Invalid pubkey in NIP-46 session descriptor');
  }
  if (descriptor.userPubkey !== undefined && !isHex(descriptor.userPubkey, 64)) {
    throw new TypeError('Invalid userPubkey in NIP-46 session descriptor');
  }
  const relays = endpoints(descriptor.relays, 'relay', 16);
  if (!relays.length) throw new TypeError('NIP-46 session descriptor requires at least one relay');
  if (typeof loadClientSecret !== 'function') {
    throw new TypeError('loadClientSecret(clientPubkey) vault callback required');
  }
  if (createTransport !== undefined && typeof createTransport !== 'function') {
    throw new TypeError('createTransport must be a function when provided');
  }

  const clientSecret = await loadClientSecret(descriptor.clientPubkey);
  if (!(clientSecret instanceof Uint8Array) || clientSecret.byteLength !== 32) {
    throw new TypeError('Vault callback must return a 32-byte Uint8Array clientSecret');
  }
  if (getPublicKey(clientSecret) !== descriptor.clientPubkey) {
    throw new Error('Loaded clientSecret does not match descriptor clientPubkey');
  }

  const pointer = { pubkey: descriptor.remotePubkey, relays, secret: null };
  return wrapRemoteSigner(() => {
    if (createTransport) return createTransport({ clientSecret, pointer, descriptor, connectOptions });
    const instance = BunkerSigner.fromBunker(clientSecret, pointer);
    return {
      connect: () => instance.connect(connectOptions),
      getPublicKey: () => instance.getPublicKey(),
      signEvent: template => instance.signEvent(template),
      ping: typeof instance.ping === 'function' ? () => instance.ping() : undefined,
      nip44Encrypt: typeof instance.nip44Encrypt === 'function' ? (p, t) => instance.nip44Encrypt(p, t) : undefined,
      nip44Decrypt: typeof instance.nip44Decrypt === 'function' ? (p, c) => instance.nip44Decrypt(p, c) : undefined,
      close: () => instance.close(),
    };
  });
}

export { checkedSign };
