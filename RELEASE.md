# Release and publication controls

<!-- FILL:artifact | DISCOVER: build artifacts, output formats, release names, versions and hashes. | ACCEPT: exact deliverable identity or evidence-backed 'not yet produced' with GAP. -->
**Artifact identity:** {{FILL:artifact}}

<!-- FILL:versioning | DISCOVER: existing release tags, deployment pipeline, backward-compatibility requirements, and source status. | ACCEPT: explicit version/upgrade policy, not an invented number. -->
**Versioning / updates:** {{FILL:versioning}}

<!-- FILL:rollback | DISCOVER: existing release or revision rollback pathway. | ACCEPT: tested recovery method or explicit unverified GAP, not merely 'git revert'. -->
**Recovery and rollback:** {{FILL:rollback}}

## Release acceptance
- Actual source and intended release bytes are inventoried, reviewed and hashed.
- Test results are tied to the exact candidate commit/artifact, not a different branch.
- External signer/account identity, publication destination, permissions and credentials are verified *only if in scope*.
- For Android, install/upgrade/back navigation/data retention are observed on target device before claiming device pass.
- For nsites, verify the **winning addressable event**, all referenced asset bytes, and user-visible retrieval; signature acceptance alone does not prove site availability.
- Deployment/publication requires a **separate explicit owner authorization**. This template does not trigger one.

- Resolve applicable [UI](UI.md), [security](SECURITY.md), [architecture](ARCHITECTURE.md) and [reuse](REUSE.md) acceptance criteria; document legitimate inapplicability and actual gaps. Update [CHANGELOG.md](CHANGELOG.md) with evidence and compatibility changes. A successful documentation gate is not release authorization.
