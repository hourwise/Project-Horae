# Project Horae Implementation Plan

This plan records intended implementation work without treating planned behavior as already present in code.

## Current Starting Point

The current public code provides:

- public schema types for runtime registrations, health, lifecycle, capabilities, profiles, sessions, and events;
- a runtime registry with lifecycle transitions, heartbeat recording, and stale-runtime degradation;
- a capability planner that filters healthy runtime capabilities;
- a session orchestrator that returns a session scaffold;
- an in-memory audit router;
- minimal `inspect()` bindings for Ananke, Mnemosyne, and gateway adapters.

## Phase 1: Runtime Registry and Composition Validation

Completed in the current implementation:

- exact protocol compatibility checks for selected runtimes using `RuntimeIdentity.protocolVersion`;
- typed rejection before session creation through `RuntimeProtocolCompatibilityError`;
- typed rejection when multiple selected runtimes advertise the same capability ID;
- a distinct `HoraeComposition` identity for each created session and `SessionOrchestrator.assessState()` for derived ready/degraded state.

Planned work:

- verify runtime identity beyond local registration presence;
- validate profile fields against public types and supported values;
- add explicit composition rejection for incompatible or missing required capabilities.

## Phase 2: Governed Runtime Boundaries

Planned work:

- route policy and approval requests through Ananke-owned interfaces;
- route qualified context retrieval through Mnemosyne-owned interfaces;
- preserve the rule that Horae can request authority but cannot create it;
- store references to runtime-owned audit rather than rewriting it.

## Phase 3: Session-Level Supervision and Recovery

Planned work:

- define session-state transitions, degraded plans, and responses to runtime failure;
- add task-level cancellation ownership and recovery semantics;
- add durable correlation persistence if recovery requires it.

## Phase 4: Data Boundaries, Providers, and Connectors

Planned work:

- encode data-boundary rules and explicit fallback behavior in public types;
- model provider transport through a separate Model Broker boundary;
- model typed external connectors and credential-broker boundaries;
- reject unsupported boundary crossings before execution.

## Phase 5: Content Surface Preflight

Planned or proposed work:

- implement the proposed Content Surface Preflight ADR if accepted;
- add controlled projection and progressive disclosure for covered content-bearing operations;
- fail closed on unsupported formats, timeout, or missing approval evidence.

## Open Questions

- whether memory is required for all task classes;
- whether a recovered runtime keeps the same identity;
- whether safe degraded mode is capability-specific or profile-specific or both;
- whether composition identity survives recovery, restart, or degraded replanning;
- how automatic restart should work for authority-bearing runtimes.
