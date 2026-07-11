# Architecture

## Role and Boundaries

Horae is a thin composition and supervision runtime. It discovers runtimes, verifies identity and protocol compatibility, plans the least-capability task composition, supervises lifecycle and health, coordinates degraded states, and correlates task-level outcomes.

It does not implement provider APIs, action policy, approval decisions, memory reliability, credential custody, or a shared audit database.

| Component | Owns | Horae must not |
| --- | --- | --- |
| Ananke | action policy, approval binding, governed tool execution, action outcomes, action audit | approve, bypass, or rewrite its audit truth |
| Mnemosyne | memory provenance, reliability, conflicts, freshness, qualified context packs | alter reliability or choose a conflicting memory as true |
| Model Broker | provider-specific model transport and normalised model profiles | call provider APIs directly |
| Connector / Credential Broker | typed external operations and credentials | hold raw tokens or expose them to models |
| Horae | composition, routing, lifecycle, health, correlation, degraded coordination, aggregate outcome | increase another component's authority |

## Composition Flow

```text
Moirae Chat / Agent Host / IDE
              |
        task + profile + disclosure boundary
              |
              v
            Horae
  +-----------+-----------+-------------+
  | discover and verify   | plan least  |
  | identity, protocol,   | capabilities|
  | capability, health    | and routes  |
  +-----------+-----------+-------------+
              |
  +-----------+-----------+-------------+
  |                       |             |
Model Broker           Mnemosyne      Ananke
  |                       |             |
model profile       context pack   governed typed effects
                                      |
                                   connectors
```

Before execution, Horae rejects incompatible runtimes, duplicate or conflicting capability providers, missing validated model capabilities, and any plan whose required disclosure conflicts with the active data boundary.

## Session and Capability Plan

A session binds project identity, task, governance profile, requested disclosure boundary, selected model profile, qualified context-pack reference, runtime bindings, capability grants, and correlation identifiers.

Capabilities are granular and task-scoped. For example, `workspace.write`, `git.commit`, `github.branch.push`, and `github.pull_request.create` are separate capabilities with separate risk and approval rules. Installed or healthy does not mean exposed. Temporary grants are removed at completion.

Fallback is an explicit, policy-bound plan. It may only preserve or strengthen privacy, locality, governance, permissions, and validated capabilities. Horae must never silently switch a local model to hosted, send source code across a prohibited boundary, change jurisdiction, or select a weaker provider for cost or speed.

## Security and Runtime Contracts

Runtime identity is not runtime truth. Cross-runtime communication must provide authenticated identity, protocol negotiation, schema validation, session binding, replay protection, sequence or timestamp handling, duplicate and stale-event handling, and auditable rejected messages.

Shared contracts describe message shapes, not authority decisions. Every effect is typed and correlated using identifiers such as `ecosystemSessionId`, `taskId`, `runtimeSessionId`, `actionId`, `contextPackId`, `approvalId`, `connectorOperationId`, and `modelInvocationId`.

Each runtime stores its data separately. Horae can maintain a task timeline that references authoritative runtime records, but it must not create shared writable databases or become a second source of truth.

## Failure and Outcomes

Failure behaviour is selected per capability, risk, runtime, and governance profile. Examples: an unavailable Ananke denies a write; unavailable Mnemosyne can permit a low-risk search with a degraded-context warning but blocks or escalates a production deployment; unavailable audit persistence denies governed writes; a GitHub failure after a local commit produces partial success without losing local state.

The aggregate outcome preserves runtime-specific outcomes and reports `COMPLETED`, `FAILED`, `DENIED`, `WAITING_FOR_APPROVAL`, `APPROVAL_INVALIDATED`, `TIMED_OUT`, `DEGRADED`, `PARTIAL_SUCCESS`, or `RECOVERABLE_RETRY`. Recovery is idempotent and must not repeat completed external effects.

## Extension Admission

Horae distinguishes Moirae-native components, governance-compatible components, and unmanaged extensions. Only components implementing required contracts, identity checks, and capability restrictions can join a governed session. Provider extensions supply transport; they do not bring their own unrestricted tools, credentials, or authority path.
