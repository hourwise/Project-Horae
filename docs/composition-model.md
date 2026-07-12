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

Designed:

- Cross-runtime discovery, identity verification, and protocol compatibility checks are repeatedly planned but are not yet implemented in the public `RuntimeRegistry`.

## Capability Selection

Implemented and tested:

- `planCapabilities()` selects visible capabilities from healthy registrations only.
- A capability becomes visible when its `id` or `category` matches either `request.requestedCapabilities` or `profile.requiredRuntimeCapabilities`.
- Hidden capabilities are still tracked, with reasons `not_requested` or `unhealthy_runtime`.

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

- Validation currently means healthy-registration filtering and capability matching. It does not yet include protocol negotiation, disclosure checks, model capability checks, or policy enforcement.

### Running composition

Implemented but scaffold-level:

- `SessionOrchestrator.start()` returns a `HoraeSession` with `runtimeIds` and `startedAt`.
- This creates a session record, but it does not start runtime processes, claim tasks, or execute actions.

### Degraded composition

Implemented and tested at runtime level:

- Individual runtime registrations can become degraded because of explicit lifecycle transition or stale heartbeat handling.

Designed at composition level:

- There is no first-class task- or session-level degraded composition type yet.

## Rejection Conditions

Implemented and tested:

- Duplicate runtime registration IDs are rejected.
- Unsupported lifecycle transitions are rejected.
- Busy state without task ownership is rejected.
- Out-of-order heartbeats are rejected.

Designed:

- Missing capability, incompatible protocol, duplicate conflicting providers, model mismatch, disclosure conflict, and required-runtime absence are planned rejection conditions but are not all enforced in current public code.

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

Open question:

- The repository does not yet define a first-class composition identifier separate from the session identifier.
- It is unresolved whether a composition remains the same identity after recovery, restart, or degraded replanning.
