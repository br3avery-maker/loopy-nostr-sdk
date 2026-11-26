import { endpoint, endpoints } from './urls.js';
import { defaultFetch } from './http.js';

export function normalizeOptions({
  relays = [],
  server,
  signer,
  storage,
  pool,
  Socket = globalThis.WebSocket,
  fetcher = defaultFetch,
  clock = () => Math.floor(Date.now() / 1000),
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('Clock function expected');
  if (pool !== undefined && (!pool || typeof pool.query !== 'function' || typeof pool.publish !== 'function')) {
    throw new TypeError('RelayPool requires query() and publish() methods');
  }
  return {
    relays: endpoints(relays, 'relay', 16),
    server: server ? endpoint(server, 'blossom') : undefined,
    signer,
    storage,
    pool,
    Socket,
    fetcher,
    clock,
  };
}
