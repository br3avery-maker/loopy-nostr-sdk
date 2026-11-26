# rc.8 independent review repairs

Source: https://github.com/br3avery-maker/gpt-plugins/pull/49, Codex review of `063f48303e7cb27b121b6353d1611daee2cafae1`. Immutable rc.7 ZIP remains the parent.

- P1: restore previously trusted `archive_sha256` as a path. Validate both hash components and canonical relative members, check containment, reject symlink components, preflight all selected objects, and use atomic file replacement so hardlinks cannot redirect writes. Conflicting same-path content is rejected. Concurrent adversarial output-directory changes are outside this private-workspace contract.
- P2: relay fallback and specialty destinations must not override negative health or write-policy evidence. Retain exclusions even for duplicate conflicting current/candidate observations. A reduced set is valid; unknown default suggestions are not live verified. Original Anchor TypeScript remains exact donor evidence.

Reproduce: `python -m unittest discover -s tests -p 'test_review_restore.py' -v` and `node --test tests/review-relay-plan.test.js`. On rc.7 all five Python and both JS cases fail; on rc.8 all pass. No live network, publication or signer access is claimed by these tests.
