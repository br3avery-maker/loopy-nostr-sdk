# Capability and API inventory

Every capability must map to real exported code, a dependent app or consumer, tests, and an evidence level. If the repository is currently empty, state this in PROJECT.md and record the implementation gap in GAPS.md. Do not promote planned or documentation-only APIs to implemented ones.

| API or capability | Source path / export | Consumer or usage example | Test evidence | State |
| --- | --- | --- | --- | --- |
| {{FILL:capability-name}} | {{FILL:capability-source}} | {{FILL:capability-consumer}} | {{FILL:capability-evidence}} | Unknown |
<!-- FILL:capability-name | DISCOVER: actual exported implementation, or record missing code as GAP. | ACCEPT: real API name, not guessed. -->
<!-- FILL:capability-source | DISCOVER: source file and symbol, pinned to revision. | ACCEPT: navigable path and export. -->
<!-- FILL:capability-consumer | DISCOVER: existing consumer/test example. | ACCEPT: exact use site or explicit 'not yet consumer-tested' with GAP. -->
<!-- FILL:capability-evidence | DISCOVER: relevant tests, failures and runtime. | ACCEPT: command, revision and precise outcome. -->

## Integration boundaries
A module's existence does not prove it is imported, connected, state-persistent, or used in a real client. Record all four stages separately when relevant.
