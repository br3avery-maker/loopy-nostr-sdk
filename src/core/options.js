import {endpoint,endpoints} from './urls.js';
export function normalizeOptions({relays=[],server,signer,storage,Socket=globalThis.WebSocket,fetcher=globalThis.fetch,clock=()=>Math.floor(Date.now()/1000)}={}){
  return {relays:endpoints(relays,'relay',16),server:server?endpoint(server,'blossom'):undefined,signer,storage,Socket,fetcher,clock};
}
