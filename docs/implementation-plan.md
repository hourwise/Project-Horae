# Implementation Plan

## Completed Stage-A adoption

- Pin and verify immutable Project Adrasteia `project-runtime-contracts@0.4.0`.
- Consume canonical runtime inspection, protocol, principal, scope, correlation and reference contracts through a pure adapter.
- Replace exact `0.1.0` matching with canonical 1.0.0–1.4.0 semantic negotiation.
- Separate peer-reported registration/health/readiness from Horae-local admission, lifecycle and observation freshness.
- Require trusted dual-principal context, bounded scope, purpose and correlation for sessions.
- Use UUID session/composition IDs and retain correlation as metadata only.
- Implement inspection-only pinned Ananke and Mnemosyne bindings plus Horae inspection CLI evidence.
- Add baseline, peer comparator, conformance, CLI and composition checks to CI.

## Deferred

- Ananke execution, approvals, grant verification and authority-bearing transport.
- Mnemosyne memory/context transport, reliability evaluation or content exposure.
- Provider/credential brokering, automatic startup/replan/recovery, durable orchestration storage and Moirae Code integration.
- Shared content preflight; the proposal remains deferred until a cross-owner contract exists.
