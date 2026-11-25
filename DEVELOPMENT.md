# Development, tests and target runtime

<!-- FILL:runtime | DISCOVER: package manifests, existing implementation, and actual device/environment requirements. | ACCEPT: verified runtime, versions and dependencies (or a linked GAP if not built). -->
## Runtime and dependencies
{{FILL:runtime}}

<!-- FILL:build | DISCOVER: existing build scripts/CI; execute in a safe environment if available. | ACCEPT: exact command, observed result/revision, artifact path and limitations. -->
## Build
{{FILL:build}}

<!-- FILL:test | DISCOVER: actual test suite and recorded checks. | ACCEPT: exact runnable command, passed/failed/skipped counts and revision; distinguish source tests from phone/live tests. -->
## Tests
{{FILL:test}}

<!-- FILL:device | DISCOVER: intended browser, Android/WebView, CLI or host; retrieve real execution evidence. | ACCEPT: target-specific acceptance path, with observed/unobserved boundaries. -->
## Device and integration acceptance
{{FILL:device}}

For applicable graphical interfaces, follow [UI.md](UI.md) and record actual target runtime and rendered evidence. For headless projects, record API/CLI and independent consumer acceptance instead. See [ARCHITECTURE.md](ARCHITECTURE.md), [REUSE.md](REUSE.md) and [SECURITY.md](SECURITY.md) for boundaries and dependencies.
