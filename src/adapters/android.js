import { androidIntent, verifyAndroidResult } from '../nostr/nip55.js';
import { isHex } from '../core/guards.js';

/** Browser-only NIP-55 launch MAY work in Android. Host must supply onReturn callback for reliable response. */
export function androidHandoff({ launch, onReturn } = {}) {
  if (typeof launch !== 'function' || typeof onReturn !== 'function') {
    throw new TypeError('Android host launch and onReturn callbacks are required');
  }
  async function invoke(requestId, uri) {
    const pending = Promise.resolve().then(() => onReturn(requestId));
    try {
      await launch(uri);
    } catch (error) {
      // Prevent detached unhandled rejection if onReturn later rejects after launch failed.
      pending.catch(() => {});
      throw error;
    }
    const reply = await pending;
    if (!reply || typeof reply !== 'object') throw new Error('Invalid Android signer response');
    return reply;
  }
  return {
    mode: 'nip55',
    async getPublicKey({ requestId, callbackUrl } = {}) {
      const uri = androidIntent({ type: 'get_public_key', requestId, callbackUrl });
      const reply = await invoke(requestId, uri);
      if (reply.id !== requestId) throw new Error('NIP-55 correlation mismatch');
      if (reply.rejected) throw new Error('User declined signing');
      const pubkey = reply.pubkey ?? reply.result;
      if (!isHex(pubkey, 64)) throw new Error('Invalid public key from Android signer');
      return pubkey;
    },
    async sign({ requestId, event, expectedPubkey, callbackUrl }) {
      const template = structuredClone(event);
      const uri = androidIntent({ type: 'sign_event', requestId, event: template, currentPubkey: expectedPubkey, callbackUrl });
      const reply = await invoke(requestId, uri);
      return verifyAndroidResult({
        requestId,
        returnedId: reply.id,
        event: reply.event,
        template,
        expectedPubkey,
        rejected: Boolean(reply.rejected),
      });
    },
  };
}
