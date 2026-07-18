# ADR-0001: Project Adrasteia Stage-A Composition Boundary

- Status: Accepted
- Date: 2026-07-18

## Decision

Horae adopts the immutable Project Adrasteia `project-runtime-contracts@0.4.0` release, Fates Runtime Protocol 1.4.0 (supported range 1.0.0–1.4.0), through `@horae/adrasteia-adapter`. The exact artifact, digest, release tag and peer checkpoints are committed in the integration baseline.

Adrasteia owns portable representation and structural validation. Horae owns discovery, admission, capability reduction, composition, session identity, local lifecycle, freshness, degradation and correlation. Ananke retains policy, approval and governed execution. Mnemosyne retains memory, provenance, reliability and qualified context.

Canonical parsing is distinct from local admission and neither is authority. Peer-reported health/readiness is distinct from Horae lifecycle/freshness. Protocol compatibility is semantic range negotiation, not exact equality. Session creation is validation-only and cannot execute, approve, retrieve memory, mint credentials or enlarge scope.

## Consequences

Horae exposes canonical, sanitized inspection via transport-neutral methods and the CLI. Ananke is tested only through its tagged public inspection surfaces; Mnemosyne through tagged transport-neutral inspection. No HTTP is invented for Mnemosyne.

Content preflight remains Proposed/Deferred because the pinned Stage-A sidecar explicitly excludes it. No provider broker, durable orchestration store, automatic recovery or Moirae Code integration is claimed. Rollback consists of removing the adapter and immutable dependency as one focused change; no peer repository or remote release is modified.
