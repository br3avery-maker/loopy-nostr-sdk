import {Nostr,Adapters} from '../src/index.js';
export function chooseBrowserSigner(){return Nostr.browserSigner(window.nostr)}
export function androidSignerForHost(host){return Adapters.androidHandoff({launch:host.launchNostrIntent,onReturn:host.waitForNostrResult})}
export function makeCopyCode(signerTransportRelays){return Nostr.nostrConnectRequest({relays:signerTransportRelays})}
