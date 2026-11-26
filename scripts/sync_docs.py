#!/usr/bin/env python3
"""Generate and verify docs/API_REFERENCE.md from docs/API_INDEX.json and package.json.

Usage:
  python3 scripts/sync_docs.py --write
  python3 scripts/sync_docs.py --check
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG_PATH = ROOT / 'package.json'
API_INDEX_PATH = ROOT / 'docs' / 'API_INDEX.json'
API_REF_PATH = ROOT / 'docs' / 'API_REFERENCE.md'

NAMESPACE_ORDER = [
    'Core',
    'Nostr',
    'Nsite',
    'Blossom',
    'Archive',
    'Directory',
    'Storage',
    'Adapters',
    'Moderation',
    'Moji',
    'Anchor',
    'Intelligence',
    'Testing',
]

NAMESPACE_NOTES = {
    'Core': (
        'Stateless primitives for bytes, UTF-8, hex, Base64/Base64url, SHA-256, MIME/media-type '
        'matching (`mediaType`, `baseMediaType`, `contentTypeMatches`), canonical URL/endpoint/path/slug '
        'validation, bounded HTTP reads (`boundedFetch`), bounded async concurrency (`mapLimit`), '
        'runtime capability checks, account session invalidation (`createAccountSession`), and '
        'versioned schema migrations (`migrateSchema`).'
    ),
    'Nostr': (
        'BIP-340 Schnorr signing/verification, canonical event templates and replacement review, '
        'NIP-07/46/55 signers and reconnectable bunker descriptors, NIP-19 codecs, NIP-05 verification, '
        'NIP-11 metadata, NIP-42 relay auth, NIP-65 relay lists and update planning, NIP-98 HTTP auth, '
        'NIP-09 deletion templates, NIP-17/59 gift-wrap DMs (`rumorTemplate`, `sealTemplate`, '
        '`giftWrapEvent`, `unwrapGiftWrap`), single-shot and pooled relay transports (`queryRelay`, '
        '`subscribeRelay`, `createRelayPool`), persistent `StorageAdapter`-backed event store '
        '(`createEventStore`), relay health cache (`createRelayHealthCache`), and event-specific '
        'relay delivery planning/execution (`planRelayDelivery`, `executeRelayDelivery`).'
    ),
    'Nsite': (
        'NIP-5A root (kind `15128`) and named (kind `35128`) static site addressing, file-map '
        'normalization, cross-platform path portability checks (`checkPortablePaths`), deterministic '
        'manifest preparation and parsing, digest-bound publication plans (`planNsitePublication`), '
        'v1 and opt-in v2 multi-copy resumable publication (`publishNsite`), verified retrieval '
        '(`resolveNsiteManifest`, `resolveManifestPath`, `loadNsiteFile`), and live/pooled '
        'baseline revision resolver (`createRelayRevisionResolver`).'
    ),
    'Blossom': (
        'BUD-01/BUD-06/BUD-11 unsigned upload and batch authorization templates, exact-byte verified '
        'uploads with optional Content-Type checks (`uploadVerified`), multi-server verified retrieval '
        '(`fetchVerified`), multi-origin copy verification (`verifyBlobCopies`), unreferenced blob '
        'auditing (`findUnreferencedBlobs`), and replica repair (`repairBlobReplicas`).'
    ),
    'Archive': (
        'Deterministic stored and async DEFLATE ZIP reading/writing (`readZip`, `writeZip`, '
        '`writeZipAsync`), CRC32, Gear CDC chunking (`GEAR_PROFILE`, `gearChunks`, `chunkManifest`, '
        '`restoreChunkManifest`), content-addressed blob store (`contentStore`), version diffing '
        'and materialization, searchable archive catalogs, lossless Markdown source comparison '
        '(`compareMarkdown`), and kind `1349` signed revision snapshots (`snapshotTemplate`, '
        '`unwrapSnapshot`, `archiveRevision`, `restoreRevision`).'
    ),
    'Directory': (
        'Versioned Nsite directory workspace curation: schema validation/upgrade, rules matching, '
        'clone stacking/unstacking, bulk collection grouping, queue navigation, publisher counts, '
        'safe URL/image normalization, static HTML metadata extraction, and reversible public/full '
        'catalog exports.'
    ),
    'Storage': (
        'Unified async `StorageAdapter` contract (`get`/`set`/`delete`/`keys`/`close?`) with '
        'in-memory (`memoryStore`), browser IndexedDB (`indexedDbStore`), Node filesystem '
        '(`fsStore`), and namespace-isolated wrapper (`scopedStore`) adapters.'
    ),
    'Adapters': (
        'Host capability detection (`browserEnvironment`) and Android NIP-55 correlated intent '
        'handoff (`androidHandoff`). Requires an explicit host callback on Android; never fakes '
        'login from a URL click.'
    ),
    'Moderation': (
        'Deterministic spam campaign detection (`campaignMatch`, `inspectNsiteSpam`, '
        '`clusterNsiteSpam`, `filterNsites`), curator blocklist parsing/merging, NIP-51 mute lists '
        '(`parseNip51MuteList`, `muteListTemplate`), compiled emoji policy filters '
        '(`compileEmojiPolicy`, `isEmojiAllowed`), and NIP-19/hex normalization helpers. Public '
        'default ban lists are empty; callers provide explicit policies.'
    ),
    'Moji': (
        'Stable SHA-256 or canonical URL emoji identity (`extractEmojiHash`, `buildStableEmojiKey`), '
        'shortcode sanitization, deterministic hash-driven stats (`deriveEmojiStatsFromHash`, '
        '`deriveEmojiStats`), and verified NIP-30 pack extraction (`parseNip30Event`, '
        '`collectNip30Emojis`).'
    ),
    'Anchor': (
        'Public-only account backup/restore without private credentials (`sanitizePublicSession`, '
        '`buildPublicAccountBackup`, `restorePublicAccountBackup`), receipt summaries '
        '(`summarizePublicationReceipts`), verified event asset extraction (`extractEventAssets`), '
        'event storage classification, kind specs, and evidence-backed outbox planning '
        '(`assessRelayOutbox`, `planVerifiedOutbox`).'
    ),
    'Intelligence': (
        'Host-independent advisory rules for preference reconstruction (`reconstructPreferences`), '
        'root-vs-named nsite safety (`analyzeNsiteIdentity`), intelligent content preparation '
        '(`detectAndPrepareContent`), relay/media coverage auditing (`auditCoverage`), '
        'relay role classification (`classifyRelay`, `buildRelayOptimizationPlan`), single-release '
        'and full-account ecosystem optimization (`auditSinglePublication`, '
        '`analyzeAccountEcosystem`), and signed Open Specs discovery/indexing (`parseOpenSpec`, '
        '`indexOpenSpecs`, `queryOpenSpecs`, `lookupKindDefinitions`).'
    ),
    'Testing': (
        'Zero-dependency offline test harnesses for SDK consumers: disposable BIP-340/NIP-44 test '
        'signers (`createTestSigner`), in-memory NIP-01/NIP-42 mock WebSocket relays '
        '(`createMockRelay`), in-memory BUD-01/06/11 mock Blossom servers (`createMockBlossom`), '
        'and strict browser-like fetch enforcement (`withStrictBrowserFetch`).'
    ),
}


def render_api_reference() -> str:
    pkg = json.loads(PKG_PATH.read_text(encoding='utf-8'))
    api_index = json.loads(API_INDEX_PATH.read_text(encoding='utf-8'))
    version = pkg.get('version', 'unknown')
    exports_map = pkg.get('exports', {})

    ordered_ns = [ns for ns in NAMESPACE_ORDER if ns in api_index] + sorted(
        ns for ns in api_index.keys() if ns not in NAMESPACE_ORDER and ns != 'facade'
    )
    total_symbols = sum(len(api_index[ns]) for ns in ordered_ns)

    lines: list[str] = [
        f'# Public API reference — Nsite Loopy SDK {version}',
        '',
        '> Generated deterministically from `docs/API_INDEX.json` and `package.json` via `python3 scripts/sync_docs.py --write`.',
        '',
        f'`import {{ createNsiteSDK, {", ".join(ordered_ns)} }} from \'@chaoticka/nsite-loopy-sdk\';`',
        '',
        f'- **Runtime API inventory**: {total_symbols} symbols across {len(ordered_ns)} namespaces (plus `createNsiteSDK` facade).',
        '- **Machine-readable index**: `docs/API_INDEX.json`',
        '- **TypeScript declarations**: `types/index.d.ts` and per-namespace subpath `.d.ts` files (strict typed, zero `any`).',
        '- **Side-effect free**: importing any namespace performs zero network, storage, or signing I/O.',
        '',
        '## Facade',
        '',
        '`createNsiteSDK(options?)` accepts `{ relays?, server?, signer?, storage?, pool?, Socket?, fetcher?, clock? }` and returns:',
        '',
        '- All 12 core/domain namespaces (`core`, `nostr`, `nsite`, `blossom`, `archive`, `directory`, `storage`, `adapters`, `moderation`, `moji`, `anchor`, `intelligence`) plus normalized `options`.',
        '- `publish(files, overrides?)` — runs `Nsite.publishNsite` using configured defaults (resolving `pubkey` from `signer` when omitted).',
        '- `query(filter, overrides?)` — queries a single `relay` or multiple `relays`, reusing an injected `RelayPool` (`overrides.pool || options.pool`) when provided and returning deduplicated, sorted `SignedEvent[]`.',
        '- `close({ closePool = true } = {})` — closes configured `storage` and (unless `closePool: false`) configured `pool`.',
        '',
        '## Subpath imports',
        '',
        '| Subpath | Entry module | Type declarations |',
        '| --- | --- | --- |',
    ]

    for sub, target in exports_map.items():
        if isinstance(target, dict):
            imp = target.get('default') or target.get('import', '')
            typ = target.get('types', '')
            lines.append(f'| `@chaoticka/nsite-loopy-sdk{sub[1:] if sub != "." else ""}` | `{imp}` | `{typ}` |')

    lines.extend([
        '',
        '## Cross-brick contracts',
        '',
        '| Brick pair / boundary | Exact contract |',
        '| --- | --- |',
        '| `createNsiteSDK({ pool })` + `Nostr.createRelayPool` | `sdk.query(filter)` returns `SignedEvent[]` (matching unpooled `queryRelay`), throwing only if every relay fails; `pool.query(relays, filter)` returns `{ events, relays, failed }`. |',
        '| `Nsite.publishNsite` (v2) + `Nsite.createRelayRevisionResolver` | Pass `resolveCurrent: Nsite.createRelayRevisionResolver({ relays, pool, Socket })` to v2 `publishNsite`; returns newest verified manifest `SignedEvent`, `null` on `not-found`, or throws on unreachable/invalid relays. |',
        '| `Nostr.createEventStore` + `{ verify: false }` | Skips redundant BIP-340 re-verification for pre-verified regular, replaceable, and addressable events while strictly validating shape, hex IDs/pubkeys, and integer timestamps. |',
        '| `Nostr.createRelayHealthCache` + `Nostr.planRelayDelivery` | `await healthCache.exportForDelivery({ now })` returns `{ observations, relayPolicies, monitorEvents }`, spreading directly into `planRelayDelivery(event, { ...exported })`. |',
        '| `Core.boundedFetch(url, init, options)` | 3-argument signature: `(url, fetchInit, { fetcher, timeoutMs, maxBytes, signal, read, acceptRedirects })`. |',
        '| `Storage.scopedStore(adapter, namespace)` | Isolates keys under `${namespace}:`; `namespace` must be non-empty and must not contain `:`. |',
        '| `Core.mediaType` / `Nsite.mediaType` | Single shared implementation in `src/core/media.js` (`mediaType`, `baseMediaType`, `contentTypeMatches`). |',
        '| `Nostr.decodeNip19` / `Moderation.decodeNip19` | Single shared implementation in `src/nostr/nip19.js` (`decodeNip19`, `noteEncode`, `nprofileEncode`, `neventEncode`, `naddrEncode`). |',
        '',
    ])

    for ns in ordered_ns:
        items = api_index[ns]
        fn_items = [x['name'] for x in items if x['kind'] == 'function']
        const_items = [x['name'] for x in items if x['kind'] != 'function']
        lines.append(f'## {ns} ({len(items)} exports)')
        lines.append('')
        note = NAMESPACE_NOTES.get(ns)
        if note:
            lines.append(note)
            lines.append('')
        if const_items:
            lines.append(f'- **Constants ({len(const_items)})**: ' + ', '.join(f'`{name}`' for name in const_items))
        if fn_items:
            lines.append(f'- **Functions ({len(fn_items)})**: ' + ', '.join(f'`{name}`' for name in fn_items))
        lines.append('')

    lines.extend([
        '## Failure states and honesty boundaries',
        '',
        '- Errors are never silently converted into empty results or verified receipts: failed relays, missing readback, signature mismatches, corrupt ZIP/CAS payloads, and unreachable baseline checks throw or return explicit failure diagnostics.',
        '- Local offline examples and tests (using `Testing` mocks) exercise real BIP-340 cryptography, NIP-5A manifest hashing, ZIP codecs, and protocol state machines, but are distinct from live relay/Blossom deployment or physical Android device verification.',
        '',
        '## Companion guides',
        '',
        '- [Options](OPTIONS.md) · [Cross-donor transport](CROSS_DONOR_TRANSPORT.md) · [History sync](CROSS_DONOR_HISTORY.md) · [Publication & plans](CROSS_DONOR_PUBLICATION.md) · [Verified retrieval](CROSS_DONOR_RETRIEVAL.md) · [Archive & snapshots](CROSS_DONOR_ARCHIVE.md)',
        '- [Relay delivery reconciliation](RELAY_DELIVERY_RECONCILIATION.md) · [Relay auth reconciliation](RELAY_AUTH_RECONCILIATION.md) · [Blossom reconciliation](BLOSSOM_RECONCILIATION.md) · [Publication v2 reconciliation](PUBLICATION_RECONCILIATION.md)',
        '- [Anchor intelligence](ANCHOR_INTELLIGENCE.md) · [Open Specs registry](OPEN_SPECS.md) · [Round 2 audit](ROUND2_AUDIT.md)',
        '',
    ])
    return '\n'.join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description='Generate or check docs/API_REFERENCE.md from docs/API_INDEX.json')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--write', action='store_true', help='Regenerate docs/API_REFERENCE.md')
    mode.add_argument('--check', action='store_true', help='Verify docs/API_REFERENCE.md matches docs/API_INDEX.json')
    args = parser.parse_args()

    rendered = render_api_reference()
    if args.write:
        API_REF_PATH.write_text(rendered, encoding='utf-8')
        api_index = json.loads(API_INDEX_PATH.read_text(encoding='utf-8'))
        namespaces = [k for k in api_index.keys() if k != 'facade']
        total = sum(len(api_index[k]) for k in namespaces)
        print(json.dumps({'status': 'UPDATED', 'path': 'docs/API_REFERENCE.md', 'namespaces': len(namespaces), 'symbols': total}, indent=2))
        return 0

    current = API_REF_PATH.read_text(encoding='utf-8') if API_REF_PATH.is_file() else ''
    if current != rendered:
        print(json.dumps({
            'status': 'FAIL',
            'path': 'docs/API_REFERENCE.md',
            'error': 'docs/API_REFERENCE.md is out of sync with docs/API_INDEX.json; run python3 scripts/sync_docs.py --write',
        }, indent=2))
        return 1

    api_index = json.loads(API_INDEX_PATH.read_text(encoding='utf-8'))
    namespaces = [k for k in api_index.keys() if k != 'facade']
    total = sum(len(api_index[k]) for k in namespaces)
    print(json.dumps({'status': 'PASS', 'path': 'docs/API_REFERENCE.md', 'namespaces': len(namespaces), 'symbols': total}, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
