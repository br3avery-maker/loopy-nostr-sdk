# Third-party notices and provenance

The root MIT license applies to original contributions the project has the right to license. Third-party material retains its original terms.

## Current public tree

The initial public revision `80c2cbb93f245341a61f43d56b4257e981e50939` contains the starter scaffold, not the SDK runtime or its bundled JavaScript. GitHub Actions references checkout and setup-python as external CI tools, not distributed runtime libraries.

## Notices identified for the SDK migration

The candidate's unmodified vendor/nostr.js bundle (recorded SHA-256 e1bdc026518da6cb69df04cc827f93410c1ed20c47017b3b6a43bfa8c1cd6d59) carries an accompanying nostr-tools Unlicense and embedded MIT copyright notices:

| Component | Copyright notice present in bundle |
| --- | --- |
| [noble-hashes](https://github.com/paulmillr/noble-hashes) | (c) 2022 Paul Miller (paulmillr.com) |
| [noble-curves](https://github.com/paulmillr/noble-curves) | (c) 2022 Paul Miller (paulmillr.com) |
| [noble-ciphers](https://github.com/paulmillr/noble-ciphers) | (c) 2023 Paul Miller (paulmillr.com) |
| [scure-base](https://github.com/paulmillr/scure-base) | (c) 2022 Paul Miller (paulmillr.com) |

The runtime bundle and [nostr-tools](https://github.com/nbd-wtf/nostr-tools) are not yet distributed in this tree. Preserve the vendor file, original Unlicense and full MIT permission texts with the original copyright notices when importing. Exact dependency versions have not been established from the embedded notices alone.

## Reference-only acknowledgments

Development comparisons included [Open Specs](https://github.com/nogringo/openspecs) (MIT; inspected revision 04a7672a19588406d0bffe710053c7d3a6146cc9), [Nostr NIPs](https://github.com/nostr-protocol/nips), [NDK](https://github.com/nostr-dev-kit/ndk), [nsite-gateway](https://github.com/hzrd149/nsite-gateway), [NostrApps](https://github.com/eskema/nostrapps), [nostrsite](https://github.com/nostrband/nostrsite) and [nsite-manager](https://github.com/hzrd149/nsite-manager). The candidate comparison records describe independent implementations of observed contracts, not direct incorporation of those runtime stacks. This is a starting acknowledgment, not an exhaustive attribution audit.

Review the exact imported source, generated code, fixtures, assets and package contents before distributing the SDK. Preserve required notices and source provenance; do not include private recovery archives or unreviewed donor material. Report omissions via [AI-DEVELOPMENT.md](AI-DEVELOPMENT.md).
