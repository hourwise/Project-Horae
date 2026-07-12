# Open Design Questions

This file collects unresolved material that should not be treated as accepted architecture yet.

## Source Notes Moved Here

This document consolidates unresolved design questions from:

- [`Thoughts.txt`](../../Thoughts.txt)
- [`docs/Core role.txt`](../Core%20role.txt)
- the documentation-pass request in [`docs/Project-Horae.txt`](../Project-Horae.txt)

## Authority and Composition

### Is optional memory valid for every task class?

Current state:

- `HoraeProfile` can mention `mnemosyneMemoryScope`, and planning docs often assume Mnemosyne participation.
- The public code does not define task classes or a rule for when memory is mandatory versus optional.

Why it remains open:

- Low-risk composition may be possible without Mnemosyne.
- High-risk tasks may need memory reliability and conflict signals before action or approval.

### Is composition identity immutable?

Current state:

- `HoraeSession.id` exists.
- `HoraeSession.composition` carries a distinct `HoraeComposition.id` with the selected runtime and capability IDs.

Why it remains open:

- The current identity is created with the session and is not persisted.
- It remains unresolved whether recovery or degraded replanning preserves that composition ID or creates a new one.

### How should Horae choose among multiple runtime instances?

Current state:

- `RuntimeRegistry` can store multiple registrations.
- The planner rejects multiple selected runtimes advertising the same capability ID.
- It does not rank or arbitrate between several equivalent providers with distinct capability IDs.

Why it remains open:

- The repository has not defined tie-break rules such as locality, freshness, trust tier, latency, or explicit operator preference.

## Health, Degradation, and Recovery

### What is a safe degraded mode?

Current state:

- Runtime-level degradation is implemented.
- `SessionOrchestrator.assessState()` exposes a derived `degraded` state and the affected runtime IDs.
- Task-level degraded plans are only described in prose.

Why it remains open:

- The answer likely varies by capability, risk, and runtime.
- A single global fail-open or fail-closed rule would contradict current planning material.

### May Horae restart authority-bearing runtimes automatically?

Current state:

- `terminated` can transition to `initialising`.
- The current code requires an explicit lifecycle transition.

Why it remains open:

- Automatic restart may be convenient for availability.
- It may also hide loss of continuity or accidentally revive a runtime that should remain unavailable until operator review.

### Does health aggregation hide component failure?

Current state:

- The public code exposes per-runtime health and lifecycle state.
- `SessionOrchestrator.assessState()` exposes a ready/degraded session summary and the affected runtime IDs.

Why it remains open:

- Operators often want a summary view.
- The current summary does not encode capability risk, safe reduced operation, or detailed degradation reasons.

### What is runtime identity after recovery?

Current state:

- The same registration ID may survive recovery through `failed -> initialising`.

Why it remains open:

- It is unclear whether recovery should preserve runtime identity, issue a new runtime instance identifier, or relate both.

## Cancellation and Ownership

### Who owns cancellation?

Current state:

- The lifecycle code can move a runtime into `cancelling`.
- Planning docs say every task should have an owner and cancellation path.

Why it remains open:

- The repository does not yet define whether cancellation is initiated by Horae, a task owner, Ananke, the UI, or the runtime itself.

## Compatibility and Negotiation

### How should negotiation failures be represented?

Current state:

- `RuntimeIdentity.protocolVersion` exists in the schema.
- `RuntimeRegistry.negotiateProtocol()` reports exact-version compatibility for selected registrations.
- `RuntimeRegistry.assertProtocolCompatibility()` rejects the first mismatch with `RuntimeProtocolCompatibilityError`.

Why it remains open:

- The current error representation covers version mismatch only. Identity mismatch, missing feature, stale schema, and unsafe fallback are not yet modeled.
- The repository has not defined whether future protocol versions should use range or feature negotiation.

## Correlation

### Which identifiers should be first-class?

Current state:

- Session, event, runtime registration, and lifecycle task ownership identifiers exist in code.
- Broader correlation identifiers appear only in prose.

Why it remains open:

- The repository has not yet settled whether composition, proposal, execution, and provider-request identifiers are all separate concepts.
