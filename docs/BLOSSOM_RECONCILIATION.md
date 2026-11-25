# Blossom publishing reconciliation — batch 2

Source comparison: the existing [Pretend Internet relay router](https://github.com/br3avery-maker/Pretend-Internet/tree/05fee992a984cd373e4283b29033f3d6256e5ab4/tools/relay-router), `router.mjs` (`preflightBlob`), and the owner-controlled recovered Safehouse publisher (`src/publish.js`: bounded responseBytes, correctType, batch authorization, copy counting, gateway verification). Private archive and original source bytes remain in the private evidence store. Independent implementation references [BUD-06](https://github.com/hzrd149/blossom/blob/master/buds/06.md), [BUD-11](https://github.com/hzrd149/blossom/blob/master/buds/11.md) and existing SDK `fetchVerified`; no new dependencies or imported donor network stack.

## Reusable APIs

```js
const blob = {sha256: hash, size: fileByteLength, type: 'text/html'};
const options = {servers: approvedServers};
const preflight = await Blossom.preflightBlob(blob, options);
const unsigned = Blossom.blossomBatchUploadAuth({hashes: reviewedHashes, servers: approvedServers});
// Sign only via the consumer's separate explicit approval. No upload is performed here.
const copies = await Blossom.verifyBlobCopies(blob, {...options, required: 2});
```

`preflightBlob` performs only explicit unauthenticated HEAD /upload metadata requests, without bodies, cookies, redirects, payment or signing. HTTP 200 is advisory acceptance; other statuses classify rejection, auth, quota, unsupported and unknown responses. No parsing of server-controlled reason text. Unknown/unsupported candidates are separate from selected candidates; neither proves storage or upload success. No automatic OPTIONS, signed HEAD or PUT. Endpoints must be explicitly supplied; no discovery or automatic background fetching.

`blossomBatchUploadAuth` prepares an **unsigned** kind-24242 upload token template scoped to 1–24 supplied hashes and 1–16 named HTTPS destinations, deduplicated and bound to server domains. Lifetime at most 600 seconds, nonempty content, created_at one second before the caller clock. It does not sign, transmit, pay or persist any token. BUD-11 scope is by hostname, not port/path; sharing a token with multiple hosts permits each scoped host to replay it within its stated scope and expiry. Callers must approve all listed hosts and hashes, and use shorter/single-server scopes where appropriate.

`verifyBlobCopies` composes existing `fetchVerified` with exact declared size and MIME checks (parameters ignored, JavaScript MIME aliases accepted). It checks each distinct successful origin, not uploader-supplied booleans or a descriptor's arbitrary URL. Wrong MIME, wrong bytes, short/oversized data, redirects, timeout and cancellation cannot count as a verified copy. Multiple paths on one origin cannot satisfy redundancy. Distinct origins do not prove distinct operators or physical storage. Readbacks are observations at request time, not durable availability guarantees. Caller chooses 1–16 required copies and a byte cap no greater than 128 MiB; per-request timeout at most 60s; sequential bounded destinations. Named HTTPS endpoints exclude IP literals, credentials, query/fragment and local hostnames. DNS/egress security is still the caller's responsibility, and injected transports must be trusted.

## Capability reconciliation

| Existing implementation | LNsdk equivalent | Disposition |
|---|---|---|
| Router.preflightBlob | Single-server upload only | Adopt metadata-only preflight, no inferred success. |
| Safehouse batched BUD-11 signing | Single-hash blossomUploadAuth | Adopt scoped unsigned templates; existing checkedSign stays the signer boundary. |
| Safehouse copy verification and MIME policy | fetchVerified first-good copy | Reuse hash/size-bounded fetch and require distinct successful origins plus expected type. |
| Safehouse multi-copy upload orchestration and manifest server hints | publishNsite single server | Outstanding: integrate copy threshold with approved publication plan, explicit signing and manifest targets; don't imply a verification helper performs upload. |
| Safehouse gateway hash/MIME readback | Nsite.loadNsiteFile verifies Blossom hash | Outstanding: separately explicit gateway verification of each expected file. |
| Resumable publication | publishNsite checkpoints | Outstanding: compare actual resume behavior in other donor versions; checkpoint is not resume. |

The original consumer is unchanged. The new functions are additive, not a replacement for existing publishNsite, uploadVerified or fetchVerified. Eight regression cases exercise simulated HTTP responses and real signing/hash verification. Live servers, browser/CORS behavior, device signer and end-to-end publication remain unverified. Broader donor coverage and reverse adoption stay open.
