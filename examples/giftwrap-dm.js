/** Run: node examples/giftwrap-dm.js. NO NETWORK, NO PUBLIC SIGNING. */
import { Nostr } from '../src/index.js';
import { createTestSigner } from '../src/testing/index.js';

const alice = createTestSigner({ includeNip44: true });
const bob = createTestSigner({ includeNip44: true });

const rumor = await Nostr.rumorTemplate({
  pubkey: alice.pubkey,
  kind: 14,
  content: 'Private NIP-17/59 gift-wrapped message (offline demo)',
  tags: [['p', bob.pubkey]],
});
const sealTmpl = await Nostr.sealTemplate(rumor, {
  recipientPubkey: bob.pubkey,
  encryptor: alice.nip44,
});
const seal = await Nostr.checkedSign(alice, sealTmpl, alice.pubkey);

const wrapped = await Nostr.giftWrapEvent(seal, {
  recipientPubkey: bob.pubkey,
  encryptorForEphemeral: sk => createTestSigner({ secretKey: sk, includeNip44: true }).nip44,
});
const unwrapped = await Nostr.unwrapGiftWrap(wrapped.event, {
  recipientPubkey: bob.pubkey,
  decryptor: bob.nip44,
});

console.log(JSON.stringify({
  state: 'OFFLINE_EXAMPLE_NO_NETWORK',
  wrapKind: unwrapped.wrap.kind,
  sealKind: unwrapped.seal.kind,
  rumorKind: unwrapped.rumor.kind,
  senderMatchesAlice: unwrapped.rumor.pubkey === alice.pubkey,
  decryptedContent: unwrapped.rumor.content,
}, null, 2));
