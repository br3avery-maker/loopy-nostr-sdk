/** Port of Anchor's NIP event storage-class contract; not a claim to implement every kind. */
import { classifyEventStorage } from '../core/guards.js';

export { classifyEventStorage };

const named = {
  0: ['Profile Metadata', 'NIP-01'],
  1: ['Text Note', 'NIP-01'],
  3: ['Follow List', 'NIP-02'],
  4: ['Encrypted Direct Message (Legacy)', 'NIP-04'],
  5: ['Deletion Request', 'NIP-09'],
  6: ['Repost', 'NIP-18'],
  7: ['Reaction', 'NIP-25'],
  20: ['Picture', 'NIP-68'],
  1059: ['Gift Wrap', 'NIP-59'],
  1063: ['File Metadata', 'NIP-94'],
  10000: ['Mute List', 'NIP-51'],
  10002: ['Relay List', 'NIP-65'],
  10030: ['Emoji List', 'NIP-30'],
  10050: ['DM Relay List', 'NIP-17'],
  10063: ['Blossom Server List', 'BUD-03'],
  15128: ['Root Nsite', 'NIP-5A'],
  20000: ['Ephemeral Event', 'NIP-01'],
  22242: ['Client Authentication', 'NIP-42'],
  24242: ['Blossom Upload Auth', 'BUD-11'],
  27235: ['HTTP Auth', 'NIP-98'],
  30023: ['Long-Form Content', 'NIP-23'],
  30030: ['Emoji Set', 'NIP-30'],
  30166: ['Relay Discovery Monitor', 'NIP-66'],
  35128: ['Named Nsite', 'NIP-5A'],
};

export function kindSpec(kind) {
  const storageClass = classifyEventStorage(kind);
  const entry = named[kind];
  return {
    kind,
    label: entry?.[0] || `Event kind ${kind}`,
    nip: entry?.[1] || 'application-defined',
    storageClass,
    requiresDTag: storageClass === 'addressable',
  };
}
