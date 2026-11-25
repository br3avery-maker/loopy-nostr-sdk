# Architecture and integration boundaries

<!-- FILL:architecture-components | DISCOVER: actual source tree, entrypoints, manifests and existing architecture decisions. | ACCEPT: component responsibilities, ownership, dependency direction and source paths; separate proposed design from existing code. -->
## Components and dependency direction
{{FILL:architecture-components}}

<!-- FILL:architecture-flow | DISCOVER: real call sites, state stores, protocols, formats and consumer workflows. | ACCEPT: data flow, identities, persistence, failures, recovery and trust boundaries with navigable evidence. -->
## Data flow and state
{{FILL:architecture-flow}}

<!-- FILL:architecture-contracts | DISCOVER: real public API/types, adapter contracts, compatibility tests and existing integrations. | ACCEPT: stable public boundaries, extension points and version/compatibility constraints or explicit implementation gaps. -->
## Contracts and integration
{{FILL:architecture-contracts}}

Keep domain logic reusable and host adapters separate when supported by the existing architecture. Do not create parallel services or move behavior merely to satisfy a diagram. Link decisions to PROJECT.md and actual source. No architecture document proves runtime behavior.
