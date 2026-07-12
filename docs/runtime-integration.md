# Runtime Integration

This document describes the repository's current runtime integration surface and the boundaries planned around it.

## Current Public Integration Surface

Implemented and tested:

- runtimes register through `RuntimeRegistry` with `RuntimeRegistration`;
- registrations carry `RuntimeIdentity`, `RuntimeHealth`, optional `RuntimeLifecycle`, and declared capabilities;
- session scaffolding reads those registrations to build a `HoraeCapabilityPlan` and `HoraeSession`.

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

Not yet enforced in current public code:

- protocol negotiation;
- capability-provider conflict resolution beyond duplicate registration IDs;
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

## Open Questions

- How protocol negotiation failures should be represented is still unresolved.
- How multiple equivalent runtime registrations should be ranked is still unresolved.
- Whether degraded tasks may continue without a required runtime depends on task class and is not yet encoded in public types.
