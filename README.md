# Project Horae

Horae is the composition and supervision runtime for the Moirae ecosystem. It assembles the smallest safe runtime composition for a task, verifies that its parts are compatible, supervises their health, and correlates their outcomes.

The official IDE name is **Moirae Code**. Use that name consistently in documentation, plans, interfaces, and user-facing copy.

Horae answers:

- Which runtimes and typed capabilities are available and compatible?
- What minimum capability set, model profile, data boundary, and governance profile does this task require?
- How should degraded runtimes, retries, and partial outcomes be handled?
- How can the task be traced across Ananke, Mnemosyne, the Model Broker, and connectors?

It is deliberately **not** a workflow engine, model provider, policy engine, memory engine, credential store, or unrestricted tool gateway.

## Authority Boundaries

Ananke owns action policy, approvals, governed execution, outcomes, and action audit records. Mnemosyne owns memory ingestion, provenance, reliability, conflict handling, freshness, and qualified context packs. The Model Broker owns provider-specific model transport. Connectors and credential brokers own external authentication and typed operations.

Horae composes and routes those capabilities; it cannot manufacture approvals, call executors around Ananke, change memory reliability, decide a memory conflict, hold raw credentials, or treat its aggregate timeline as a replacement for runtime-owned audit records.

The governing rule is: **coordination may reduce capability, but must never silently expand it.**

## Runtime Shape

```text
Moirae Code / Agent Host
               |
             Horae
      +--------+---------+---------+
      |                  |         |
  Model Broker      Mnemosyne    Ananke
      |                  |         |
  model providers   context packs  typed connectors / governed effects
```

Every cross-runtime message requires authenticated identity, compatible protocol versions, schema and session validation, replay/staleness handling, and correlation identifiers. A local runtime is not automatically trusted, and a local model does not receive authority merely because it is local.

## Working Principles

- Compose task-scoped, least-capability sessions; remove temporary capabilities when the task ends.
- Treat hosted-model invocation as a governed data disclosure. Do not cross a local/remote boundary, provider jurisdiction, privacy boundary, or governance profile by silent fallback.
- Keep workspace writes, local Git, and remote GitHub operations as separate typed capabilities.
- Do not expose credentials to models or use unrestricted shell access to bypass typed adapters.
- Make failure behaviour risk-sensitive. A runtime failure must never become an authority bypass.
- Return typed aggregate outcomes such as `COMPLETED`, `DENIED`, `DEGRADED`, `PARTIAL_SUCCESS`, and `RECOVERABLE_RETRY`; never repeat a completed external effect during recovery.

## Research-Derived Build Requirements

The research requirements extend the implementation programme without changing Horae's authority boundary:

- Import compatible Agent Skills manifests as governed registrations with provenance, declared capabilities, secret and network requirements, runtime/model compatibility, and an explicit trust state. Registration and discovery never grant authority; Ananke still authorises actions.
- Provision workers only for capabilities required by an active task, with the minimum context and authority needed to perform it.
- Give every runtime and worker an explicit lifecycle, health state, owner, scope, and cancellation path, including cooperative cancellation, forced termination, partial-result collection, cleanup verification, handoff, and orphan cleanup.
- Select execution targets through a sandbox-neutral schema covering host, process, container, microVM, and remote-sandbox isolation. Horae selects a compatible target; Ananke approves or denies execution.
- Select models by declared and observed capabilities and active policy rather than vendor branding. Provider changes and execution location remain explicit.
- Represent speech as a typed capability profile covering locality, streaming, duplex mode, locales, confidence, and interruption support.
- Admit AgentScope, OpenCode-derived tools, and other frameworks through governed adapters for identity, capability, lifecycle, cancellation, outcomes, audit correlation, memory handoff, and health.

## Packages

| Package | Purpose | Status |
| --- | --- | --- |
| `@horae/schema` | Horae-local composition, session, capability, outcome, and correlation types | ✅ Phase 2 Complete |
| `@horae/runtime-registry` | Runtime identity, compatibility, health, and capability registration | ✅ Phase 1 Complete |
| `@horae/capability-planner` | Least-capability, task-scoped composition planning | ✅ Phase 1 Complete |
| `@horae/session-orchestrator` | Lifecycle, degraded-state coordination, and aggregate outcomes | ✅ Phase 2 Complete |
| `@horae/profile-loader` | Governance, data-boundary, and fallback-profile validation | ✅ Phase 1 Complete |
| `@horae/ananke-binding` | Policy evaluation, approval binding, governed execution, audit correlation | ✅ Phase 2 Complete |
| `@horae/mnemosyne-binding` | Context pack retrieval, reliability signals, memory degradation handling | ✅ Phase 2 Complete |
| `@horae/gateway-adapter` | Typed connector and gateway route abstraction, never an authority bypass | ⏳ Phase 3 |
| `@horae/audit-router` | Correlation, timeline, and references to runtime-owned audit records | ✅ Phase 2 Complete |
| `@horae/runtime-core` | Thin composition layer | ✅ Phase 2 Complete |
| `@horae/cli` | Inspection, planning, session, and validation-report commands | ✅ Phase 1 Complete |
| `@horae/testbench` | Compatibility, authority, failure, and recovery scenarios | ✅ Phase 2 Complete |

## Implementation Status

### Phase 1 ✅ COMPLETE - Secure Registry and Least-Capability Planner

**Features:**
- Runtime discovery with authenticated identity verification
- Protocol version negotiation and compatibility enforcement
- Capability manifest validation with duplicate/conflict detection
- Health monitoring and readiness tracking
- Profile validation with data-boundary constraints
- Fallback rule validation (ensures boundaries only strengthened)
- Deterministic capability planning with selection reason tracking
- CLI commands: `horae plan`, `horae inspect`, `horae register`
- Output formats: JSON, YAML, human-readable table

**CLI Usage:**
```bash
# Generate a capability plan with full reasoning
horae plan --profile personal-dev --task "Edit workspace" --output json --file plan.json

# Inspect registered runtimes and capabilities
horae inspect --format table

# Register a new runtime
horae register --runtime ./runtime-config.json
```

**Test Coverage:**
- 40+ validation tests
- Identity verification, protocol negotiation, manifest validation
- Duplicate provider detection, singleton enforcement
- Health monitoring, least-capability planning
- Profile and fallback validation
- Composition validation, end-to-end scenarios

### Phase 2 ✅ COMPLETE - Governed Vertical Slice

**Features:**
- Cross-runtime correlation IDs throughout entire flow
- Message contracts with session binding and idempotency
- Ananke policy evaluation with risk assessment
- Exact payload approval with cryptographic binding
- Payload mutation detection → approval invalidation
- Mnemosyne context pack retrieval with reliability signals
- Low-reliability and conflicting memory signals in policy evaluation
- 8-step correlated orchestration flow
- Audit trail correlation across all runtimes
- Graceful degradation (Mnemosyne unavailable → fail-closed DEGRADED outcome)
- JSON and CSV validation report generation
- Audit timeline with full event tracing

**Orchestration Flow:**
1. Discover runtimes and verify compatible protocols
2. Start correlated session, retrieve context pack with reliability signals
3. Propose governed action, pass context safety signals to policy evaluation
4. Receive policy outcome, request exact payload approval
5. Approve payload, prove invalidation detection (payload mutation fails)
6. Execute approved unmutated payload
7. Correlate audit references from Ananke and Mnemosyne
8. Handle runtime degradation (Mnemosyne down → deny writes, continue low-risk with warning)
9. Generate combined validation reports

**Test Coverage:**
- 20+ end-to-end tests
- Runtime discovery and verification
- Context pack retrieval with reliability signals
- Policy evaluation with context safety signals
- Exact payload approval, binding, and mutation detection
- Action execution and audit correlation
- Degradation scenarios
- Report generation (JSON and CSV)
- Full vertical slice repeatability

### Phase 3 🔄 IN PROGRESS - Lifecycle, Failure, and Recovery

**Planned Features:**
- Startup, shutdown, restart, readiness, and health-change coordination
- Risk-aware degraded-state tables (per capability, risk, runtime, profile)
- Partial success outcomes with recovery instructions
- Idempotency keys and completed-effect records
- Retry without repeating external effects
- Deny governed writes when audit persistence unavailable
- Allow only explicitly safe reduced compositions

**Success Criteria:**
- Recovery after connector failure following local commit produces PARTIAL_SUCCESS
- Retry retries only unfinished connector operation
- No external effect repeated during recovery
- Full lifecycle coordination tested

## Local State

Horae keeps its own state under `.project-moirae/horae/`; each runtime has separate storage. Secrets remain in the operating-system credential store or connector-specific secure custody, never in project storage or model context.

Directory structure:
```
.project-moirae/
  horae/
    runtimes/           # Runtime configurations
    profiles/           # Governance profiles
    validation-reports/ # Generated reports
```

## Testing

Run all tests:
```bash
npm test
```

Run Phase 1 validation tests:
```bash
npm run test -- phase1-validation
```

Run Phase 2 vertical slice tests:
```bash
npm run test -- phase2-vertical-slice
```

Run testbench:
```bash
npm run test:bench
```

## Development

Build all packages:
```bash
npm run build
```

Run CLI in development:
```bash
npm run dev:cli -- plan --profile personal-dev --task "Test task"
```

Format and lint:
```bash
npm run format
npm run lint
```

## Architecture Principles

1. **Horae coordinates authority; it does not create it.**
2. **Every composition uses the least capability required for its task.**
3. **No runtime may increase another runtime's authority.**
4. **Runtime identity does not imply runtime truth.**
5. **Compatibility is enforced before execution, not merely documented.**
6. **Failure must never become an authority bypass.**
7. **Fallback must not weaken privacy, capability, locality, or governance.**
8. **Data leaving a boundary is itself a governed action.**
9. **Credentials belong to brokers and connectors, never to models or Horae.**
10. **Every cross-runtime effect is typed, attributable, and correlatable.**
11. **Completed external effects are never repeated during recovery.**
12. **Horae may aggregate outcomes, but runtime-owned records remain authoritative.**

See [Laws of Horae](docs/laws-of-horae.md) for the complete formal statement.

## Documentation

- [Architecture](docs/architecture.md) - System design and boundaries
- [Implementation Plan](docs/implementation-plan.md) - Phase breakdown and success criteria
- [Roadmap](docs/roadmap.md) - Feature timeline
- [Laws of Horae](docs/laws-of-horae.md) - Governance principles
- [Runtime Integration](docs/runtime-integration.md) - How to integrate external runtimes
- [Research and Requirements](docs/PROJECT_HORAE_RESEARCH_AND_REQUIREMENTS.md) - Additional skill, worker, sandbox, model, voice, and adapter requirements

## Current Status

✅ **Phase 1 & 2 Complete** - All core registry, planning, and governed vertical slice functionality implemented and tested.

🔄 **Phase 3 Underway** - The typed runtime lifecycle state machine, task ownership, cancellation, termination, recovery, and heartbeat supervision are implemented. Partial outcomes and idempotent recovery remain next.

The TypeScript workspace is production-ready for Phase 3 development. Core competencies proven:
- Identity verification prevents impersonation
- Protocol negotiation enforces compatibility
- Capability planning enforces least-privilege
- Policy decisions respected throughout
- Exact payload binding detects mutations
- Audit trails fully correlated
- Degradation handled gracefully
- Repeatable, deterministic orchestration
