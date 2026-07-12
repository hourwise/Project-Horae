# Composition Model

This document describes how Horae composes runtimes and capabilities, separating current public code from planned behavior.

## Status Legend

- `Implemented and tested`
- `Implemented but scaffold-level`
- `Designed`
- `Proposed`

## Repository Evidence

- Public composition types in [`packages/schema/src/index.ts`](../packages/schema/src/index.ts)
- Capability planner in [`packages/capability-planner/src/index.ts`](../packages/capability-planner/src/index.ts)
- Session scaffolding in [`packages/session-orchestrator/src/index.ts`](../packages/session-orchestrator/src/index.ts)
- Runtime registration and health state in [`packages/runtime-registry/src/index.ts`](../packages/runtime-registry/src/index.ts)
- Orchestration scaffold test in [`packages/testbench/src/orchestration.test.ts`](../packages/testbench/src/orchestration.test.ts)

## Composition Inputs

### Task requirements

Implemented and tested:

- A task enters Horae as `HoraeSessionRequest` with `projectId`, `profileId`, `task`, and optional `requestedCapabilities`.

Designed:

- Risk class, disclosure needs, model requirements, connector needs, and mandatory runtime declarations appear in planning documents but are not part of the current public `HoraeSessionRequest` type.

### Profile requirements

Implemented and tested:

- `HoraeProfile` currently requires `id`, `displayName`, `projectId`, `requiredRuntimeCapabilities`, `auditDestinations`, and `capabilityExposure`.
- Optional profile fields currently include `defaultGateway`, `anankePolicyProfile`, and `mnemosyneMemoryScope`.

Documentation conflict:

- [`docs/profile-example.json`](profile-example.json) contains fields such as `governanceProfile`, `dataBoundary`, `model`, and `connectors` that are not in the current public `HoraeProfile` type, and it uses `capabilityExposure: "task-scoped"` even though the public type only allows `fixed` or `progressive`.

## Runtime Discovery and Registration

Implemented and tested:

- Horae can register runtimes through `RuntimeRegistry.register()`.
- A registration includes `id`, `identity`, `health`, capabilities, and optional lifecycle state.
- Duplicate registration IDs are rejected.

Implemented and tested:

- `RuntimeRegistry.negotiateProtocol()` compares selected registrations with the expected Horae protocol version.
- `SessionOrchestrator.start()` rejects a selected runtime whose protocol version does not exactly match the configured Horae protocol version.
- The default session protocol version is `0.1.0`; `SessionOrchestrator` accepts an explicit override for a future host contract.

Designed:

- Cross-runtime discovery and identity verification remain planned. Protocol compatibility is implemented only as exact string matching; the schema does not define semver or range negotiation.

## Capability Selection

Implemented and tested:

- `planCapabilities()` selects visible capabilities from healthy registrations only.
- A capability becomes visible when its `id` or `category` matches either `request.requestedCapabilities` or `profile.requiredRuntimeCapabilities`.
- Hidden capabilities are still tracked, with reasons `not_requested` or `unhealthy_runtime`.
- `findCapabilityProviderConflicts()` detects when more than one selected runtime advertises the same capability ID, and `SessionOrchestrator.start()` rejects that composition.

Implemented but scaffold-level:

- `HiddenCapability.reason` also allows `profile_disallowed`, `incompatible`, and `unknown`, but the planner does not currently emit those reasons.

## Mandatory and Optional Runtimes

Implemented and tested:

- Mandatory runtimes are currently inferred from the visible capability providers returned by `HoraeCapabilityPlan.requiredRuntimeIds`.

Designed:

- Separate declarations for mandatory versus optional runtimes are described in planning docs, but they are not first-class public types today.

Open question:

- Whether optional memory is valid for every task class is not settled in code or accepted ADRs.

## Composition Phases

### Desired composition

Implemented and tested:

- The desired composition is represented by `HoraeSessionRequest` plus `HoraeProfile`.

### Validated composition

Implemented and tested:

- The validated composition is the `HoraeCapabilityPlan` created from the current registry snapshot and requested capabilities.

Limit:

- Validation includes healthy-registration filtering, capability matching, and exact protocol compatibility checks for selected runtimes. It does not yet include disclosure checks, model capability checks, or policy enforcement.

### Running composition

Implemented but scaffold-level:

- `SessionOrchestrator.start()` returns a `HoraeSession` with `runtimeIds`, `startedAt`, and a distinct `HoraeComposition` record.
- This creates a session record, but it does not start runtime processes, claim tasks, or execute actions.

### Degraded composition

Implemented and tested:

- Individual runtime registrations can become degraded because of explicit lifecycle transition or stale heartbeat handling.
- `SessionOrchestrator.assessState()` reports a session as `degraded` when one of its selected runtimes is missing, no longer healthy, or has a degraded, cancelling, terminated, or failed lifecycle state.
- The assessment identifies the degraded runtime IDs and does not itself mutate runtime lifecycle state, replan the composition, or continue work.

## Rejection Conditions

Implemented and tested:

- Duplicate runtime registration IDs are rejected.
- Unsupported lifecycle transitions are rejected.
- Busy state without task ownership is rejected.
- Out-of-order heartbeats are rejected.

Implemented and tested:

- Incompatible protocol versions are rejected for selected runtimes before `SessionOrchestrator.start()` creates a session.
- A selected capability ID advertised by more than one runtime is rejected before `SessionOrchestrator.start()` creates a session.

Designed:

- Missing capability, model mismatch, disclosure conflict, and required-runtime absence remain planned rejection conditions and are not all enforced in current public code.

Open question:

- Multiple providers with distinct capability IDs remain selectable. The repository does not yet define how Horae chooses among equivalent providers.

## Model and Provider Requirements

Designed:

- The repository plans a separate Model Broker and model capability profiles.
- Current public code does not include model-selection or provider-transport types in `@horae/schema`.

## Data Boundaries and Fallback

Designed:

- Data-boundary and fallback behavior appear in [runtime-integration.md](runtime-integration.md), [implementation-plan.md](implementation-plan.md), and [PROJECT_HORAE_RESEARCH_AND_REQUIREMENTS.md](PROJECT_HORAE_RESEARCH_AND_REQUIREMENTS.md).
- These rules are not yet encoded in the exported public types or exercised in tests.

## Composition Identity

Implemented and tested:

- `HoraeSession.id` identifies a session created by `SessionOrchestrator.start()`.
- `HoraeSession.composition` is a first-class `HoraeComposition` record with its own ID, selected runtime IDs, selected capability IDs, and creation time.
- `HoraeComposition.id` is distinct from `HoraeSession.id`; neither current string format is a stable external contract.

Open question:

- It is unresolved whether a composition remains the same identity after recovery, restart, or degraded replanning.
