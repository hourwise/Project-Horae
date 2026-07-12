# Degradation and Recovery

This document records what the repository currently proves about degradation and recovery, and what remains designed or unresolved.

## Repository Evidence

- Runtime lifecycle and heartbeat handling in [`packages/runtime-registry/src/index.ts`](../packages/runtime-registry/src/index.ts)
- Lifecycle tests in [`packages/testbench/src/lifecycle.test.ts`](../packages/testbench/src/lifecycle.test.ts)
- Orchestration scaffold test in [`packages/testbench/src/orchestration.test.ts`](../packages/testbench/src/orchestration.test.ts)
- Planning and boundary docs in [implementation-plan.md](implementation-plan.md), [runtime-integration.md](runtime-integration.md), and [architecture.md](architecture.md)

## Status Legend

- `Implemented and tested`
- `Designed`
- `Proposed`
- `Open question`

## Scenario Matrix

| Scenario                                      | Current status                                | May work continue?                                                            | What is degraded or missing?                                                                  | Required visibility                                       | Automatic recovery                              | Prohibited behavior                                                  |
| --------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| Lost heartbeat for an active runtime          | Implemented and tested                        | Not automatically; the runtime remains registered but enters `degraded` state | Runtime health freshness and active service confidence                                        | Explicit degraded lifecycle state and health message      | No                                              | Treating the runtime as silently healthy                             |
| Heartbeat reports `degraded` or `unavailable` | Implemented and tested at runtime level       | Not defined at task level                                                     | Runtime health and, for active runtimes, lifecycle state                                      | Explicit degradation in registry state                    | No                                              | Keeping `ready` or `busy` while health is degraded                   |
| Out-of-order heartbeat                        | Implemented and tested                        | No heartbeat update is accepted                                               | Freshness ordering guarantee                                                                  | Error from `RuntimeRegistry.recordHeartbeat()`            | No                                              | Accepting stale heartbeat as newer truth                             |
| Runtime failure after registration            | Implemented and tested                        | Not automatically                                                             | Runtime service availability                                                                  | Explicit `failed` lifecycle state                         | Only explicit transition back to `initialising` | Silent recovery without lifecycle change                             |
| Explicit runtime recovery from `failed`       | Implemented and tested                        | Yes, after explicit operator or orchestrator action                           | Prior failed state remains meaningful history, though not yet persisted beyond registry state | Explicit `initialising` transition                        | No                                              | Implicitly treating a recovered runtime as if it never failed        |
| Cancellation of an active runtime             | Implemented and tested at runtime-state level | Work is stopping                                                              | The runtime remains task-owned while cancelling                                               | `cancelling` state with `cancellationRequestedAt`         | No                                              | Reusing the runtime for a different task during cancellation         |
| Partial task outcome after a later failure    | Designed                                      | Intended yes                                                                  | Final task outcome is incomplete                                                              | Planned typed aggregate outcome such as `PARTIAL_SUCCESS` | Planned retry logic                             | Repeating already-completed external effects                         |
| Runtime restart during a task                 | Designed                                      | Unclear                                                                       | Runtime continuity and task identity                                                          | Should be explicit in audit and correlation               | Unresolved                                      | Silent restart that hides loss of continuity                         |
| Incompatible protocol version                 | Designed                                      | No                                                                            | Runtime compatibility                                                                         | Visible rejection before execution                        | No                                              | Silent fallback to an incompatible runtime                           |
| Ananke unavailable for governed write         | Designed                                      | No for governed write                                                         | Required approval and governed execution authority                                            | Explicit denial or fail-closed outcome                    | Unresolved                                      | Bypassing Ananke or manufacturing approval                           |
| Mnemosyne unavailable for low-risk work       | Designed                                      | Maybe, depending on policy                                                    | Qualified memory context                                                                      | Degraded-context warning or explicit denial               | Unresolved                                      | Presenting degraded work as fully contextualised                     |
| Mnemosyne unavailable for high-risk work      | Designed                                      | Unclear by task class                                                         | Memory-derived context and safety signals                                                     | Explicit denial or escalation                             | Unresolved                                      | Silent continuation for high-risk work                               |
| Provider or connector unavailable             | Designed                                      | Depends on whether a reduced composition exists                               | Transport or external effect path                                                             | Explicit degraded or recoverable outcome                  | Unresolved                                      | Silent route substitution across boundaries                          |
| Lost correlation data                         | Open question                                 | Unknown                                                                       | Ability to tie runtime records together                                                       | Should be visible if it occurs                            | Unresolved                                      | Claiming authoritative cross-runtime reconstruction without evidence |
| Content preflight scanner timeout             | Proposed                                      | No for covered content route                                                  | Required preflight observation and approval evidence                                          | Fail-closed route result                                  | Unresolved                                      | Falling through to full content access                               |

## Implemented Runtime-Level Recovery Rules

The current public code proves these runtime-level rules:

- stale active runtimes are degraded rather than deregistered;
- task ownership survives transitions through `busy`, `waiting`, `degraded`, `cancelling`, and `failed` where allowed;
- failed runtimes do not recover automatically;
- a recovered runtime returns through `initialising`, not directly to `ready`.

## Recovery Gaps in the Current Public Code

The repository does not yet provide public code for:

- aggregate task outcomes such as `PARTIAL_SUCCESS`, `DEGRADED`, or `RECOVERABLE_RETRY`;
- retry plans or completed-effect records;
- session-level degraded plans;
- recovery of audit correlation after process loss;
- restart handling for authority-bearing runtimes;
- connector or provider failover logic.

## Documentation Conflicts

- Existing planning prose in [README.md](../README.md), [roadmap.md](roadmap.md), and [architecture.md](architecture.md) previously described broader degradation and recovery behavior than the current public code proves. This document uses code and tests as the higher-priority evidence source.

## Open Questions

- What qualifies as a safe degraded mode by task class remains unresolved.
- Whether health aggregation may hide component failure behind a higher-level session summary remains unresolved.
- Whether identity is preserved or renewed after runtime recovery remains unresolved.
