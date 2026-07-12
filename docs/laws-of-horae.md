# The Laws of Horae

This document formalises the governing rules for Horae using current repository evidence.

## Status Legend

- `Accepted`: supported by the current code, tests, or stable top-level repository boundary.
- `Proposed`: present in planning material or requested design, but not implemented in the current public code.

## Accepted Laws

### Law 1. Coordination Must Not Expand Authority

Horae may coordinate authority-bearing runtimes, but it must not manufacture authority they did not grant.

Why this is accepted:

- The repository boundary assigns policy and approval ownership to Ananke, memory truth to Mnemosyne, and provider credentials to brokers or connectors in [README.md](../README.md) and [architecture.md](architecture.md).
- The current public code exposes inspection interfaces for Ananke, Mnemosyne, and gateway adapters, but no direct approval or execution path in Horae-owned packages.

### Law 2. Prefer the Smallest Sufficient Composition

Each task should receive the smallest capability set that satisfies the request and active profile.

Why this is accepted:

- `HoraeProfile.requiredRuntimeCapabilities`, `HoraeSessionRequest.requestedCapabilities`, and `HoraeCapabilityPlan` are public types in [`packages/schema/src/index.ts`](../packages/schema/src/index.ts).
- `planCapabilities()` filters visible capabilities to healthy registrations and requested or required capabilities in [`packages/capability-planner/src/index.ts`](../packages/capability-planner/src/index.ts).

### Law 3. Preserve Runtime Ownership

Horae may aggregate state about other runtimes, but ownership of policy, memory, provider transport, credentials, and runtime-specific audit remains with the runtime that provides it.

Why this is accepted:

- The repository-level ownership split is stated in [README.md](../README.md) and detailed in [architecture/ownership-matrix.md](architecture/ownership-matrix.md).
- The current public code keeps Horae-owned storage to session, registration, and event scaffolding. It does not export APIs that rewrite Ananke or Mnemosyne records.

### Law 4. Reject Invalid Runtime Lifecycle Progression

Horae must reject unsupported runtime lifecycle transitions instead of silently coercing them.

Why this is accepted:

- `RuntimeRegistry.transitionLifecycle()` validates transitions against `ALLOWED_LIFECYCLE_TRANSITIONS` and throws `RuntimeLifecycleError` on invalid moves in [`packages/runtime-registry/src/index.ts`](../packages/runtime-registry/src/index.ts).
- Lifecycle rejection is integration-tested in [`packages/testbench/src/lifecycle.test.ts`](../packages/testbench/src/lifecycle.test.ts).

### Law 5. Make Degradation Visible

When a runtime becomes stale, degraded, or unavailable, Horae must preserve that state explicitly instead of hiding the failure behind a healthy aggregate.

Why this is accepted:

- `markStaleRuntimes()` marks stale registrations as degraded and preserves a degradation message in [`packages/runtime-registry/src/index.ts`](../packages/runtime-registry/src/index.ts).
- Stale-heartbeat degradation and retained task ownership are tested in [`packages/testbench/src/lifecycle.test.ts`](../packages/testbench/src/lifecycle.test.ts).
- `SessionOrchestrator.assessState()` surfaces a derived `degraded` state and affected runtime IDs for a session's selected composition.

### Law 6. Correlation Does Not Transfer Authority

Correlation identifiers connect events and state across runtimes, but they do not grant permission, truth, or execution rights.

Why this is accepted:

- The current public types expose `HoraeSession.id`, `HoraeComposition.id`, `HoraeEvent.id`, `HoraeEvent.sessionId`, `HoraeEvent.runtimeId`, and `RuntimeLifecycle.taskId` in [`packages/schema/src/index.ts`](../packages/schema/src/index.ts).
- No code path in the repository treats a correlation field as an approval or credential.

### Law 7. Aggregate Records Do Not Replace Runtime-Owned Audit

Horae may keep a correlated task timeline, but that timeline does not become the authoritative audit record for other runtimes.

Why this is accepted:

- The current audit implementation is only `InMemoryAuditRouter`, which stores Horae events without rewriting runtime-owned records in [`packages/audit-router/src/index.ts`](../packages/audit-router/src/index.ts).
- Repository boundary docs consistently reserve authoritative audit ownership for the runtime that produced it.

### Law 8. Recovery Must Preserve Task Ownership and Avoid Silent Reassignment

Runtime recovery must remain explicit, and task ownership must not silently move to a different task during lifecycle recovery.

Why this is accepted:

- `RuntimeRegistry.resolveTaskId()` prevents a busy runtime from being claimed by a different task ID in [`packages/runtime-registry/src/index.ts`](../packages/runtime-registry/src/index.ts).
- Recovery from `failed` to `initialising` is explicit and tested in [`packages/testbench/src/lifecycle.test.ts`](../packages/testbench/src/lifecycle.test.ts).

## Proposed Laws

### Proposed Law 9. Reject Incompatibility Before Execution

Horae should reject incompatible protocol versions, runtime identities, capability sets, and disclosure conflicts before task execution begins.

Why this is proposed:

- Exact protocol compatibility for selected runtimes is now checked by `RuntimeRegistry` and `SessionOrchestrator` before session creation.
- Identity verification, broader capability compatibility, and disclosure conflict checks remain unimplemented, so the broader law is not yet fully enforceable. Exact duplicate selected capability IDs are rejected.

### Proposed Law 10. Never Silently Bypass a Required Runtime

If a required runtime such as Ananke or Mnemosyne is unavailable for a task class that depends on it, Horae should deny or visibly degrade the task instead of silently bypassing that runtime.

Why this is proposed:

- This principle is explicit in planning docs, but there is no current execution path in code where bypass could be proven or prevented.

### Proposed Law 11. Recovery Preserves Original Intent and Approval Scope

If Horae resumes or retries work, it should preserve the original task intent and any approval scope rather than broadening it during recovery.

Why this is proposed:

- The current code preserves runtime task ownership, but it does not yet model approval scope, execution plans, or retryable task outcomes.

### Proposed Law 12. Horae May Reduce or Stop a Composition, but It Cannot Manufacture Missing Authority

Horae should be allowed to degrade, cancel, or terminate a composition when safety or health requires it, but it should not substitute missing authority from another runtime.

Why this is proposed:

- Runtime cancellation and termination states exist in the lifecycle code.
- Cross-runtime authority substitution remains a design rule rather than an executable check in the current public code.

### Proposed Law 13. Mandatory Content Routing Requires Explicit Preflight

Covered content-bearing operations should pass through Content Surface Preflight before content is exposed to an agent, user, downstream tool, or memory system.

Why this is proposed:

- The rule is defined in the proposed ADR [ADR-XXXX-horae-mandatory-content-preflight-routing.md](ADR-XXXX-horae-mandatory-content-preflight-routing.md).
- No current public package exports content-preflight types or routing behavior.

## Open Questions

- Whether optional memory is allowed for every task class remains unresolved. See [notes/open-design-questions.md](notes/open-design-questions.md).
- Whether degraded health can safely hide component failure inside a task-level summary remains unresolved.
- Whether task identity should survive runtime restart unchanged is still a design question outside the current code.
