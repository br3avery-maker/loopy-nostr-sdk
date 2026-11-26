import { browserSigner } from '../nostr/signers.js';
import { indexedDbStore } from '../storage/indexeddb.js';
import { defaultFetch } from '../core/http.js';

/** Explicit browser capabilities; avoids inventing an Android bridge. */
export function browserEnvironment({
  signer = globalThis.window?.nostr,
  storage = globalThis.indexedDB,
  Socket = globalThis.WebSocket,
  fetcher = defaultFetch,
} = {}) {
  return {
    signer: signer ? browserSigner(signer) : null,
    storage: storage ? indexedDbStore({ indexedDBProvider: storage }) : null,
    Socket,
    fetcher,
  };
}
