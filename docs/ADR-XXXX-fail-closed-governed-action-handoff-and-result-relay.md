# ADR-XXXX: Fail-Closed Governed Action Handoff and Result Relay

## Status

Proposed — design decision only. This ADR neither implements a transport nor activates FATES-SLICE-002.

## Context

The Stage-A baseline at \`52e14fa574f7427f62747fe84d2789aec25b94e3\` provides canonical inspection, admission, capability reduction, session validation, freshness assessment, and correlation structures. Its Ananke binding is explicitly read-only inspection; it has no execution, dispatch, or result relay. That missing boundary blocks the proposed route:

\`\`\`text
Moirae constrained host -> Horae -> Ananke -> Horae -> Moirae constrained host
\`\`\`

Horae must remain an orchestration/supervision runtime: it must not make an authority decision or physically read the fixture.

## Proposed decision: one local HTTP topology

The proposed topology is **separate local processes over loopback HTTP**. Moirae Code, Horae, and Ananke are independently started local processes by a controlled Slice 02 harness. The harness supplies fixed loopback endpoints and expected artifact/runtime identities; it does not import a sibling package as the runtime implementation. No generic package call, MCP adapter, child-process tool protocol, durable session, or workflow is selected.

The future narrow path has two HTTP hops:

\`\`\`text
Moirae constrained host
  -- local POST /slice-02/governed-actions --> Horae
  -- authenticated local POST /api/execute --> admitted Ananke
  -- typed relay response ------------------> Horae
  -- typed response ------------------------> Moirae constrained host
\`\`\`

Loopback transport authentication establishes runtime/host identity but is not an action credential, provider credential, or caller-supplied secret. The fixture action has no credential capability. The detailed local process attestation/capability arrangement must be approved with the implementation; it must not be placed in model content, request JSON, or environment-derived action arguments.

## Horae-local interfaces

No portable contract change is proposed. A future Horae implementation may use local interfaces equivalent to:

\`\`\`text
Slice02HandoffRequest
  action = fates.slice02.inspect-fixed-fixture.v1
  arguments = { fixtureId, expectedSha256 }
  origin = Moirae runtime/instance/artifact/schema receipt
  execution = trusted dual-principal context
  scope = bounded ResourceScope
  purpose, validity, correlation

Slice02RouteReceipt
  routeId, Horae event ID, admitted Ananke identity/endpoint receipt,
  negotiated protocol, fresh-readiness observation, request-schema digest

Slice02HandoffResult
  route state, distinct Horae route/event IDs, original correlation,
  Ananke decision/outcome/audit references, typed result or typed failure
\`\`\`

These are Horae-local because their endpoint, route, fixture, and relay semantics are not yet demonstrated reusable portable structures. Existing Adrasteia \`AgentExecutionContext\`/\`DualPrincipalContext\`, \`ResourceScope\`, \`CorrelationContext\`, \`RuntimeIdentity\`, \`RuntimeRegistration\`, \`RuntimeReadiness\`, \`Capability\`, protocol negotiation, references, and generic \`Result<T>\` cover the shared structural fields.

## Admission, identity, and readiness before dispatch

Horae must admit the configured Ananke endpoint through its existing canonical inspection/admission model before the action route is exposed. For every dispatch it must, in this order:

1. require the exact registered action and a capability declaration that is active, admitted, healthy, dependency-available, and selected by monotonic capability reduction;
2. fetch/revalidate Ananke identity, registration, compatibility, health, and readiness from the configured loopback endpoint immediately before dispatch;
3. require the Ananke runtime name, instance/endpoint receipt, locked artifact expectation, protocol range, and selected action capability to match the route record;
4. reject a readiness observation older than **1,000 ms**, a not-ready or degraded required dependency, incomplete startup/registration, a dead process, endpoint/instance drift, capability drift, or protocol mismatch;
5. validate the Moirae origin and request-schema receipt, preserve the original correlation ID, and create separate Horae \`routeId\` and event ID;
6. only then forward the exact request to Ananke's canonical execution endpoint.

The 1,000 ms value is an explicit Slice 02 design bound, not a durable heartbeat policy. A cached readiness record, even if the process remains alive, is insufficient. Reinspection failure is \`unavailable\` or \`indeterminate\`, not an assumption of readiness.

## Fail-closed and relay semantics

Horae refuses dispatch when Ananke is unregistered, unready, stale, unhealthy, incompatible, missing the exact action capability, at a changed endpoint or instance, or when origin/schema identity is malformed. It never reads the fixture, does not replace Ananke's decision, and cannot turn a denied outcome into a transport failure.

The relay preserves the initiating correlation and Ananke producer-owned decision/outcome/audit references. Horae adds, rather than overwrites, its own route/event IDs. The local result taxonomy is:

| Route state | Meaning |
| --- | --- |
| \`completed\` | Ananke returned a valid typed completed outcome. |
| \`denied\` | Ananke denied or invalidated the authority decision; no Horae reinterpretation. |
| \`unavailable\` | Required process, endpoint, registration, or readiness source was unavailable. |
| \`stale\` | Required readiness/identity observation exceeded the 1,000 ms bound. |
| \`incompatible\` | Protocol, runtime identity, endpoint, or declared capability did not match. |
| \`malformed\` | Request, origin, schema receipt, or trusted context validation failed. |
| \`timed_out\` | The authoritative result did not arrive before the bounded timeout. |
| \`indeterminate\` | Transport failed after dispatch began and no authoritative Ananke outcome was received. |

No \`timed_out\` or \`indeterminate\` result is success. There is no retry, compensation, persistence, durable workflow, MRTR, replanning, or fallback in this slice. Minimal cancellation is permitted only before Horae dispatches; it returns a typed cancellation/refusal. After dispatch begins, cancellation does not invent an abort protocol or erase the need to wait for either an authoritative result or timeout evidence.

## Binding rules

Before forwarding, Horae binds and records: action identity; strict arguments and their canonical digest; trusted principal pair; tenant/project/workspace and bounded scope; purpose and validity; original Moirae runtime/instance/artifact origin; request schema ID/digest; admitted Ananke runtime/instance/endpoint identity; protocol negotiation; fresh readiness observation; initiating correlation; and distinct Horae route/event IDs. Ananke remains the authority owner for its policy version, decision identity, approval reference where applicable, execution audit, physical read, and outcome.

## Acceptance tests before implementation approval

The future implementation plan must define real process-boundary tests for:

1. successful dispatch and typed relay through the three processes;
2. an Ananke denied result with no Horae decision rewrite;
3. startup/registration race and process-alive-but-not-ready refusal;
4. stale readiness, incompatible protocol, endpoint identity drift, and capability drift refusal before Ananke invocation;
5. origin/schema/action/argument mutation rejection;
6. bounded timeout and indeterminate relay behavior with no false success or retry;
7. correlation preservation plus distinct Moirae, Horae, and Ananke producer identifiers;
8. evidence that no fixture read occurs when Horae refuses dispatch.

Mocks may unit-test local parsing but cannot be presented as the cross-runtime proof.

## Consumer checkpoint and handoff

Before Moirae Code consumes this boundary, Horae must provide a clean, pushed, green checkpoint; exact commit/artifact identity; selected topology and endpoint contract; freshness threshold and timeouts; identity/protocol/capability admission evidence; positive and negative test report; route/bypass limits; and a handoff packet naming the exact Ananke checkpoint consumed. Integration may use that packet only for later cross-runtime proof, never as a substitute for running the route.

## Consequences and exclusions

This ADR is the owner design for the missing runtime boundary. It does not approve a Runtime Contracts change, an MCP 2026 migration, content preflight, Mnemosyne, remote OAuth, provider routing, arbitrary HTTP sessions, workflow persistence, retry, compensation, or global host governance.
