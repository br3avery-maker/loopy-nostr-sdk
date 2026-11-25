# Release and publication controls

**Artifact identity:** Source candidate `@chaoticka/nsite-loopy-sdk@1.1.1-rc.9`; build with `npm pack --ignore-scripts`. The local source file pins are in `provenance/manifest.json`; exact public commit and tarball digest must be recorded by the repository CI before a registry release. GAP-002 tracks release and independent installation.

**Versioning / updates:** Keep the existing npm package identity and semantic version progression; rc.9 supersedes the private rc.8 candidate without modifying its stored bytes. Document changed defaults/timing and maintain API compatibility. No automatic publication.

**Recovery and rollback:** Earlier candidates remain preserved with original hashes. Recovery uses checked-out exact prior source or an already verified versioned tarball; test consumer compatibility before switching. Public rc.9 clean-install and rollback acceptance still require the release gate (GAP-002).

## Release acceptance
- Actual source and intended release bytes are inventoried, reviewed and hashed.
- Test results are tied to the exact candidate commit/artifact, not a different branch.
- External signer/account identity, publication destination, permissions and credentials are verified *only if in scope*.
- For Android, install/upgrade/back navigation/data retention are observed on target device before claiming device pass.
- For nsites, verify the **winning addressable event**, all referenced asset bytes, and user-visible retrieval; signature acceptance alone does not prove site availability.
- Deployment/publication requires a **separate explicit owner authorization**. This template does not trigger one.

- Resolve applicable [UI](UI.md), [security](SECURITY.md), [architecture](ARCHITECTURE.md) and [reuse](REUSE.md) acceptance criteria; document legitimate inapplicability and actual gaps. Update [CHANGELOG.md](CHANGELOG.md) with evidence and compatibility changes. A successful documentation gate is not release authorization.

- Include [MIT](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md), the bundled upstream license files and [AI development notice](AI-DEVELOPMENT.md) in the actual npm package. Check contents before any publication.
