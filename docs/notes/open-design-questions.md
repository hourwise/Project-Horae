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
- There is no first-class composition identifier.

Why it remains open:

- A degraded or recovered composition may need a stable identity for audit and operator understanding.
- Replanning after runtime loss might reasonably produce a new composition.

### How should Horae choose among multiple runtime instances?

Current state:

- `RuntimeRegistry` can store multiple registrations.
- The planner filters by health and capability, but it does not rank or arbitrate between several equivalent providers.

Why it remains open:

- The repository has not defined tie-break rules such as locality, freshness, trust tier, latency, or explicit operator preference.

## Health, Degradation, and Recovery

### What is a safe degraded mode?

Current state:

- Runtime-level degradation is implemented.
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
- There is no implemented session-level health summary.

Why it remains open:

- Operators often want a summary view.
- A summary can become misleading if it hides that one required runtime failed.

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
- No public code negotiates or rejects protocol versions yet.

Why it remains open:

- A failure may need to distinguish identity mismatch, version mismatch, missing feature, stale schema, or unsafe fallback.

## Correlation

### Which identifiers should be first-class?

Current state:

- Session, event, runtime registration, and lifecycle task ownership identifiers exist in code.
- Broader correlation identifiers appear only in prose.

Why it remains open:

- The repository has not yet settled whether composition, proposal, execution, and provider-request identifiers are all separate concepts.
