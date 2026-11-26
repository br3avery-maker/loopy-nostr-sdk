import { endpoint, endpoints } from './urls.js';
import { defaultFetch } from './http.js';

export function normalizeOptions({
  relays = [],
  server,
  signer,
  storage,
  Socket = globalThis.WebSocket,
  fetcher = defaultFetch,
  clock = () => Math.floor(Date.now() / 1000),
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('Clock function expected');
  return {
    relays: endpoints(relays, 'relay', 16),
    server: server ? endpoint(server, 'blossom') : undefined,
    signer,
    storage,
    Socket,
    fetcher,
    clock,
  };
}
