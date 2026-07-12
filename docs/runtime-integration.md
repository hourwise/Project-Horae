# Runtime Integration

This document describes the repository's current runtime integration surface and the boundaries planned around it.

## Current Public Integration Surface

Implemented and tested:

- runtimes register through `RuntimeRegistry` with `RuntimeRegistration`;
- registrations carry `RuntimeIdentity`, `RuntimeHealth`, optional `RuntimeLifecycle`, and declared capabilities;
- session scaffolding reads those registrations to build a `HoraeCapabilityPlan`, `HoraeComposition`, and `HoraeSession`.
- `SessionOrchestrator.assessState()` derives `ready` or `degraded` for a session's selected runtime IDs without changing lifecycle state or replanning.

Implemented but scaffold-level:

- `AnankeBinding`, `MnemosyneBinding`, and `GatewayAdapter` each expose only `inspect(): Promise<RuntimeRegistration>`.

## What a Runtime Must Currently Provide

To participate in the public code that exists today, a runtime registration must provide:

- a stable registration `id`;
- a `RuntimeIdentity` with `runtime`, `version`, and `protocolVersion`;
- a `RuntimeHealth` record with `status` and `checkedAt`;
- a capability list.

## Current Enforcement

Implemented and tested:

- duplicate registration IDs are rejected;
- unsupported lifecycle transitions are rejected;
- busy state requires task ownership;
- out-of-order heartbeats are rejected;
- stale active runtimes are degraded.
- selected runtimes with a protocol version different from Horae's expected version are rejected before session creation;
- selected runtimes that advertise the same capability ID are rejected before session creation;

Not yet enforced in current public code:

- disclosure-boundary enforcement;
- approval routing through Ananke;
- qualified-context retrieval through Mnemosyne;
- connector credential rules as executable checks.

## Planned Runtime Boundaries

Designed boundaries in repository prose:

- Ananke owns policy, approval, governed execution, and runtime-owned action audit.
- Mnemosyne owns memory provenance, reliability, conflicts, freshness, and qualified context.
- A Model Broker owns provider-specific transport.
- Connectors or credential brokers own external authentication and raw credentials.

These boundaries are consistent across the repository, but only a small part of them is implemented in current code.

Protocol compatibility currently uses exact string equality. `RuntimeRegistry.negotiateProtocol()` returns the compatible and incompatible selected runtime IDs, while `assertProtocolCompatibility()` raises `RuntimeProtocolCompatibilityError` for the first mismatch. No fallback or range-based compatibility is implemented.

Capability-provider conflict detection treats the same capability ID from multiple selected runtimes as a conflict and raises `CapabilityProviderConflictError`. It does not choose between distinct capability IDs that provide an equivalent category.

## Open Questions

- Whether protocol versions should gain range or feature negotiation semantics is unresolved.
- Broader negotiation failure categories, such as identity mismatch or unsupported capability features, are not yet represented.
- How multiple equivalent runtime registrations should be ranked is still unresolved.
- Whether degraded tasks may continue without a required runtime depends on task class and is not yet encoded in public types.
