---
name: recover-nsite
description: Restore a versioned nsite from NIP-5A manifest paths, content-addressable blobs or strict ZIP archives without losing provenance, versions or clone relationships.
---

# Recover nsite files and lineage

Inputs: trusted signed manifest or original ZIP, known Blossom hosts and local content store. Outputs: byte-identical recovered files, digest receipts, version diff, optional deterministic ZIP.

For live manifests, use `Nsite.parseManifest` with cryptographic verification, then `Blossom.fetchVerified` on each path hash. For archives use `Archive.readZip` with byte/ratio limits and `Archive.contentStore` to deduplicate. `materializeVersion`, `diffVersions`, and `groupVersions` reconstruct signed generations while retaining history. `Archive.writeZip` produces stored ZIPs without changing individual bytes.

A missing asset is not a completed recovery. Never claim a rebuilt ZIP has the original ZIP's hash; its member hashes may match even if its outer ZIP compression and metadata differ.
