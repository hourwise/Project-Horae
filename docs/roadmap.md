# Horae Roadmap

## ✅ COMPLETE — Establish the Safety Baseline (Phase 1)

**Deliverables:**
- ✅ Publish thin-coordinator role, authority laws, runtime contracts, data-boundary guidance
- ✅ Align TypeScript package scaffold to identity, compatibility, least-capability planning, correlation, and typed outcomes
- ✅ Define governance-compatible admission requirements for runtimes, models, and connectors

**Implementation:**
- ✅ Enhanced schema with validation types, correlation IDs, message contracts
- ✅ RuntimeRegistry with identity verification, protocol negotiation, conflict detection
- ✅ ProfileLoader with data-boundary and fallback validation
- ✅ CLI commands (plan, inspect, register) with multiple output formats
- ✅ 40+ comprehensive validation tests
- ✅ Test fixtures and profiles

**Status:** ✅ COMPLETE - All Phase 1 success criteria met and tested

---

## ✅ COMPLETE — Prove One Governed Vertical Slice (Phase 2)

**Deliverables:**
- ✅ Discover Ananke and Mnemosyne, authenticate identity, and reject incompatible protocols
- ✅ Start correlated session, retrieve qualified/conflicted context pack, and route workspace write through Ananke
- ✅ Prove exact-payload approval binding and invalidation, correlate runtime audit references, and test Mnemosyne degradation
- ✅ Export JSON and CSV validation reports

**Implementation:**
- ✅ Cross-runtime communication contracts with correlation IDs
- ✅ AnankaBridge: policy evaluation, exact payload approval, invalidation detection
- ✅ MnemosyneBridge: context pack retrieval with reliability signals
- ✅ GovernedSessionCoordinator: 8-step orchestration with full audit correlation
- ✅ ReportGenerator: JSON and CSV validation reports with timeline
- ✅ 20+ comprehensive end-to-end tests
- ✅ Approval binding proves mutation detection
- ✅ Mnemosyne degradation → fail-closed DEGRADED outcome

**Status:** ✅ COMPLETE - Full vertical slice repeatable, no bypasses, full correlation maintained

---

## 🔄 IN PROGRESS — Make Failure Safe and Recoverable (Phase 3)

**Implemented foundation (11 July 2026):**
- Added explicit runtime lifecycle contracts and validated state transitions
- Added task ownership across busy, waiting, degraded, cancelling, and failed states
- Added guarded cancellation, termination, recovery, and deregistration behavior
- Added lifecycle testbench coverage and repaired deterministic project-reference builds

**Planned Deliverables:**
- Add lifecycle and health supervision, stale/duplicate/replayed-event defences, and risk-aware degraded plans
- Implement typed aggregate outcomes, partial-success recovery, and idempotency protections
- Deny governed writes when audit persistence or required governance is unavailable
- Provision the minimum workers required by declared task capabilities, with minimum context and authority
- Add cooperative cancellation, forced termination, partial-result collection, cleanup verification, handoff, and orphan cleanup

**Estimated Features:**
- Startup, shutdown, restart, readiness, and health-change coordination
- Risk-aware degraded-state tables (per capability, risk, runtime, profile)
- Partial success outcomes with recovery instructions
- Idempotency keys and completed-effect records
- Retry without repeating external effects
- Stale/duplicate/replayed-event detection and rejection
- Lifecycle coordination across runtimes
- Explicit lifecycle states from registration and initialisation through cancellation, termination, recovery, and failure
- Task ownership, scope, cancellation paths, and typed cancellation outcomes

**Success Criteria:**
- Recovery after connector failure following local commit produces PARTIAL_SUCCESS
- Retry only unfinished operations
- No external effect repeated during recovery
- Full lifecycle coordination tested
- Cancellation and abandoned-work cleanup verified without orphaned tasks or workers

**Estimated Timeline:** Q3 2026

---

## ⏳ LATER — Add Models, Typed Connectors, Sandboxes, and Adapters (Phase 4)

- Integrate separate Model Broker with normalised, validated model profiles
- Select models by declared and observed capability and policy, not vendor branding; keep provider changes explicit
- Enforce disclosure boundaries and privacy-preserving fallback rules
- Add credential-brokered typed connectors (workspace, local-Git, GitHub)
- Add sandbox-neutral execution targets for host, process, container, microVM, and remote sandboxes, with Ananke approval
- Add governed Agent Skills-compatible registration with provenance, requirements, compatibility, and trust state
- Add external-framework adapters covering identity, lifecycle, cancellation, outcomes, audit correlation, memory handoff, and health
- Add typed speech capability profiles for local and cloud voice compositions
- Remove temporary external grants at task completion

**Estimated Timeline:** Q4 2026

---

## ⏳ FUTURE — Moirae Code and Extensibility (Phase 5)

- Surface model, boundary, governance, context reliability, capability, approval, health, degradation, and correlation state in Moirae Code
- Standardise all IDE references and user-facing copy on the product name **Moirae Code**
- Admit only Moirae-native or governance-compatible extensions to governed sessions
- Expand adversarial testbench before broader feature development

**Estimated Timeline:** 2027

---

## Implementation Progress

| Phase | Status | Completion |
|-------|--------|------------|
| Phase 1: Safety Baseline | ✅ COMPLETE | 100% |
| Phase 2: Vertical Slice | ✅ COMPLETE | 100% |
| Phase 3: Failure & Recovery | 🔄 IN PROGRESS | Foundation implemented |
| Phase 4: Models, Connectors, Sandboxes & Adapters | ⏳ PLANNED | 0% |
| Phase 5: Moirae Code & Extensions | ⏳ PLANNED | 0% |

## Key Achievements

✅ Identity verification prevents runtime impersonation
✅ Protocol negotiation enforces compatibility before execution
✅ Capability planning enforces least-privilege composition
✅ Exact payload approval binding detects any mutation
✅ Policy decisions respected throughout orchestration
✅ Audit trails fully correlated across runtimes
✅ Mnemosyne reliability signals guide policy evaluation
✅ Degradation handled gracefully (fail-closed when critical runtimes unavailable)
✅ Repeatable, deterministic task orchestration
✅ Comprehensive validation reports (JSON and CSV)
✅ Full test coverage for all completed phases

## Research Requirements Coverage

The [Project Horae Research and Requirements](PROJECT_HORAE_RESEARCH_AND_REQUIREMENTS.md) document is an input to the build roadmap. Phase 3 covers capability-based worker provisioning, lifecycle, cancellation, and abandoned-work cleanup. Phase 4 covers Agent Skills registration, sandbox-neutral routing, capability-based model and speech profiles, and external-framework adapters. Phase 5 exposes the resulting governed composition through **Moirae Code**.
