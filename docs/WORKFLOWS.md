# Workflows and promotion contract

**Pipeline:** discover exact source → preserve source SHA and occurrence path → inspect actual implementation and licenses → extract reusable module → unify public inputs/outputs → independently test module → integrate a real consumer → document network/device limitations → archive source, API, test receipts and restoration procedure. Do not conflate search index, semantic similarity, tests and deployment.

1. Use existing `scripts/nsite_source_audit.py scan` to make per-ZIP/HTML source candidates, or `source_collection.py export` for complete exact-code source files (see 38-source companion collection). Originals stay unchanged.
2. Use **existing** IC Workshop Loopy/Embeddy and Code Quarry when installed. Their indexed candidates are semantic hints, not callable SDK modules. No replacement embedder or database is bundled here.
3. Select a source mechanism and record its donor path/hash; check for an equivalent capability among the exports in `docs/API_INDEX.json`. Extend the existing namespace rather than inventing a parallel toolkit.
4. Keep user-owned/private sources in the private source collection; include in the portable SDK only the reviewed implementation and redistributable notice. Preserve old working code as reference or donor, not falsely claim it is newly compiled.
5. Implement a positive and failure-path test; run `npm run verify`, `python3 -m unittest discover -s tests -p 'test_*.py'`, optional live device tests; update `validation/verification.json` only from actual results.
6. When adapting Deepink, do not redesign its social UI. Use `docs/DEEPINK_CONSUMER.md`. Publication to public Nostr or app stores is separately authorized.
7. Preserve ZIP/manifest receipts to Library and the existing IC Live folder; do not overwrite original archives. For public code hosting, first check license and credential safety.

Workflows under `workflows/*.json` are machine-readable task recipes, not scheduled jobs. `.github/workflows/verify.yml` runs offline test/type/package gates on authorized code changes; it never signs or deploys.
