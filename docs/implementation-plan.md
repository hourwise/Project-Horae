# Project Horae Implementation Plan

## Product Constraint

Horae is the composition and supervision plane for governed runtimes. Its value is correct composition of independent components, not absorbing their responsibilities. It must remain a thin, least-authority coordinator.

## Phase 0 — Contracts and Admission

Extend `project-runtime-contracts` with implementation-neutral message shapes:

- authenticated `RuntimeIdentity`, supported protocol versions, capability manifests, and health/readiness;
- session and correlation identifiers;
- typed capability grants, routes, disclosure constraints, and degraded-state declarations;
- normalised model profile and validated capability evidence;
- runtime-specific outcomes and typed aggregate-outcome references;
- message envelopes with schema version, session binding, timestamps or sequence numbers, and idempotency keys.

The contracts describe shapes only. They implement no policy, approval, memory scoring, provider transport, or credential decisions.

Success criterion: mocked Ananke, Mnemosyne, Model Broker, and connector registrations negotiate a compatible version; incompatible identities, schemas, or duplicated conflicting providers are rejected.

## Phase 1 — Secure Registry and Least-Capability Planner

- Implement runtime discovery, authenticated registration, capability-manifest validation, compatibility enforcement, and health/readiness monitoring.
- Implement profile validation for governance, model fallback, data disclosure, local/remote boundary, and connector availability.
- Implement deterministic task plans with only requested, compatible, healthy, policy-allowed capabilities.
- Model local workspace, local Git, and remote connectors as distinct typed capabilities.
- Record why every capability is selected, hidden, denied, or removed.

Success criterion: a CLI can produce a deterministic plan that rejects missing capability, duplicate provider, unvalidated model feature, and source-code disclosure to a prohibited remote model.

## Phase 2 — Governed Vertical Slice

Implement one complete, correlated flow before adding feature breadth:

1. Discover Ananke and Mnemosyne and verify compatible protocols.
2. Start a correlated task session and retrieve a qualified context pack containing a low-reliability or conflicting memory signal.
3. Propose a governed `workspace.write`; pass the context safety signal to Ananke.
4. Receive Ananke's policy outcome, approve the exact payload, mutate it to prove approval invalidation, then execute the approved version.
5. Correlate references to Ananke and Mnemosyne audit records.
6. Stop Mnemosyne and verify the configured degraded or fail-closed behaviour.
7. Export combined JSON and CSV validation reports.

Success criterion: the full flow is repeatable and no component bypasses Ananke, changes Mnemosyne's judgement, or loses correlation after a runtime restart.

## Phase 3 — Lifecycle, Failure, and Recovery

Implementation began on 11 July 2026 with the typed runtime lifecycle state machine, transition validation, task ownership retention, cancellation/termination/recovery paths, lifecycle testbench coverage, and heartbeat supervision. Heartbeats are ordered, stale active runtimes are degraded while retaining task ownership, and lifecycle recovery remains explicit.

- Implement the runtime lifecycle state machine: `registered`, `initialising`, `ready`, `busy`, `waiting`, `degraded`, `cancelling`, `terminated`, and `failed`.
- Add register, initialise, heartbeat, task claim, pause, resume, cancel, terminate, recover, deregister, restart, readiness, and health-change coordination.
- Provision workers only for declared capabilities required by the active task, then give them the minimum context and authority needed.
- Add cooperative cancellation, forced termination, typed partial-result collection, cleanup verification, task-state handoff, and orphan cleanup.
- Implement risk-aware degraded-state tables rather than a global fail-open/fail-closed switch.
- Preserve local state on remote failure and return typed partial outcomes with recovery instructions.
- Use idempotency keys and completed-effect records so retries never repeat an external effect.
- Deny governed writes when audit persistence is unavailable; allow only explicitly safe reduced compositions.

Success criterion: recovery after a connector failure following a local commit produces `PARTIAL_SUCCESS` and can retry only the unfinished connector operation; cancellation returns a typed outcome and verifies cleanup without abandoning an owned task or worker.

## Phase 4 — Models, Connectors, Sandboxes, and Framework Adapters

- Consume Model Broker profiles rather than provider-specific APIs.
- Select models using declared and observed capability profiles, including context, tools, vision, structured output, reasoning controls, local execution, streaming audio, reliability, and known failure modes.
- Enforce model validation, locality, privacy, jurisdiction, structured-output, and permitted-fallback constraints at composition time; long context must not substitute for qualified project memory.
- Treat hosted invocation as a disclosure decision and keep secrets, prohibited data, and unapproved source code outside its context.
- Admit typed connectors with broker-held credentials; ensure models never receive tokens.
- Add sandbox-neutral execution targets for host, process, container, microVM, and remote-sandbox isolation. Horae selects a compatible target and Ananke authorises execution.
- Import compatible Agent Skills manifests with source provenance, capabilities, secret/network requirements, supported runtimes/models, and `unreviewed`, `verified`, `restricted`, or `blocked` trust state.
- Add governed framework adapters for identity, capabilities, lifecycle, cancellation, messaging, outcomes, audit correlation, memory handoff, and health.
- Add speech capability profiles covering on-device, local-service, and cloud modes; streaming, duplex, locale, confidence, and interruption support.
- Remove temporary external capabilities after completion.

Success criterion: local-to-hosted fallback and endpoint impersonation are denied; skills and framework adapters cannot gain authority through discovery; execution location is explicit; permitted fallback remains observable and policy-bound.

## Phase 5 — Moirae Code Experience

Expose governed-session state for Moirae Code: selected model, governance profile, runtime health, enabled capabilities, local/remote boundary, context reliability and conflicts, pending approvals, degraded state, correlation trail, and aggregate outcome.

Use **Moirae Code** as the IDE product name in all implementation artifacts and user-facing text.

The IDE may request actions but must not turn human terminal access into agent authority.

## Package Responsibilities

| Package | Responsibility |
| --- | --- |
| `schema` | Horae-local composition, correlation, plans, outcomes, and validated profile types |
| `runtime-registry` | discovery, identity, protocol/capability compatibility, health, admission |
| `capability-planner` | least-capability plans, disclosure constraints, selection reasons |
| `session-orchestrator` | lifecycle, degraded coordination, idempotent recovery, aggregate outcomes |
| `profile-loader` | governance, boundary, fallback, and connector-profile validation |
| `ananke-binding` | identity, health, policy, approval, execution routes, audit references |
| `mnemosyne-binding` | identity, health, qualified context packs, reliability/conflict signals |
| `gateway-adapter` | typed routes and connector metadata; never raw credential access |
| `audit-router` | correlated timeline and references to authoritative runtime records |
| `runtime-core` | thin composition only |
| `testbench` | adversarial compatibility, authority, failure, and recovery scenarios |

## Required Initial Testbench

- incompatible protocols, forged identities, duplicate capabilities, stale and duplicate events;
- replayed or invalidated approvals, runtime restarts, and lost safety signals;
- Ananke unavailable for writes and Mnemosyne unavailable for high-risk work;
- partial success and retry after a completed local effect;
- local-to-remote fallback, endpoint impersonation, and invalid model declarations;
- connector token non-exposure, direct-executor bypass, namespace collision, SQLite separation, and temporary grant removal.
- worker cancellation during execution, forced termination and cleanup verification, orphan recovery, and task-state handoff;
- skill registration without implicit authority, blocked skill admission, unsupported runtime/model combinations, and undeclared network or secret requirements;
- explicit sandbox selection and Ananke denial, framework-adapter lifecycle conformance, provider-switch visibility, and speech-boundary enforcement.

## Planning Inputs

The [Project Horae Research and Requirements](PROJECT_HORAE_RESEARCH_AND_REQUIREMENTS.md) document is a normative planning input for Phases 3 and 4. Its schemas should be reconciled with `project-runtime-contracts` before implementation so shared result, lifecycle, execution-target, model, speech, skill, and adapter types remain framework-neutral.
