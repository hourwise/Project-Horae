# Supervision State Machine

This document describes the runtime supervision state machine that is supported by the current public code, and it separates those states from requested but not yet implemented orchestration phases.

## Repository Evidence

- `RuntimeLifecycleState` in [`packages/schema/src/index.ts`](../packages/schema/src/index.ts)
- Allowed transitions in [`packages/runtime-registry/src/index.ts`](../packages/runtime-registry/src/index.ts)
- Lifecycle tests in [`packages/testbench/src/lifecycle.test.ts`](../packages/testbench/src/lifecycle.test.ts)

## Supported State Machine

The current public state machine is runtime-scoped, not task-orchestrator-scoped.

Supported states:

- `registered`
- `initialising`
- `ready`
- `busy`
- `waiting`
- `degraded`
- `cancelling`
- `terminated`
- `failed`

### Transition Graph

| State          | Allowed transitions                                      |
| -------------- | -------------------------------------------------------- |
| `registered`   | `initialising`, `terminated`                             |
| `initialising` | `ready`, `cancelling`, `failed`                          |
| `ready`        | `busy`, `degraded`, `cancelling`, `terminated`, `failed` |
| `busy`         | `waiting`, `ready`, `degraded`, `cancelling`, `failed`   |
| `waiting`      | `busy`, `ready`, `degraded`, `cancelling`, `failed`      |
| `degraded`     | `ready`, `cancelling`, `terminated`, `failed`            |
| `cancelling`   | `terminated`, `failed`                                   |
| `terminated`   | `initialising`                                           |
| `failed`       | `initialising`, `terminated`                             |

## State Definitions

### `registered`

- Owner: Horae runtime registry
- Entry: `register()` with no explicit lifecycle state
- Meaning: runtime is known to Horae but has not yet initialised for work
- Health requirement: none beyond stored registration health
- Prohibited transitions: direct move to `busy`, `waiting`, `degraded`, or `ready`
- Recovery: can initialise or terminate
- Terminal: no

### `initialising`

- Owner: Horae runtime registry
- Entry: explicit transition from `registered`, `terminated`, or `failed`
- Meaning: runtime is entering service or recovering after failure
- Health requirement: not enforced by code
- Prohibited transitions: direct move back to `registered`, `busy`, `waiting`, or `degraded`
- Recovery: can become `ready`, `cancelling`, or `failed`
- Terminal: no

### `ready`

- Owner: Horae runtime registry
- Entry: successful initialisation or recovery from degradation
- Meaning: runtime is available for task work
- Health requirement: not enforced in transition code, but stale or degraded heartbeat can move it away from `ready`
- Prohibited transitions: direct move to `registered` or `waiting`
- Recovery: can return from `degraded`
- Terminal: no

### `busy`

- Owner: Horae runtime registry plus the task owner recorded in `taskId`
- Entry: explicit transition from `ready` or `waiting` with a task owner
- Meaning: runtime is actively owned by a task
- Health requirement: none in code, though stale or degraded heartbeat may demote it
- Prohibited transitions: entry without a task owner; reassignment to a different task owner
- Recovery: may move to `waiting`, `ready`, `degraded`, `cancelling`, or `failed`
- Terminal: no

### `waiting`

- Owner: Horae runtime registry
- Entry: explicit transition from `busy`
- Meaning: runtime still belongs to the current task but is not actively executing
- Health requirement: none enforced
- Prohibited transitions: direct entry from `registered` or `initialising`
- Recovery: may resume `busy` work while keeping the same task owner
- Terminal: no

### `degraded`

- Owner: Horae runtime registry
- Entry: explicit transition or automatic degradation from `ready`, `busy`, or `waiting`
- Meaning: runtime remains registered but is no longer considered fully healthy
- Health requirement: often paired with `degraded` or `unavailable` heartbeat status, but explicit transition is also possible
- Prohibited transitions: direct move to `busy` without first returning to `ready`
- Recovery: explicit move to `ready`, `cancelling`, `terminated`, or `failed`
- Terminal: no

### `cancelling`

- Owner: Horae runtime registry
- Entry: explicit transition from `initialising`, `ready`, `busy`, `waiting`, or `degraded`
- Meaning: runtime is stopping task work after cancellation has been requested
- Health requirement: none enforced
- Prohibited transitions: direct exit back to `ready` or `busy`
- Recovery: must either terminate or fail
- Terminal: no

### `terminated`

- Owner: Horae runtime registry
- Entry: explicit transition from `registered`, `ready`, `degraded`, or `cancelling`, or from `failed`
- Meaning: runtime is no longer active
- Health requirement: none
- Prohibited transitions: all except `initialising`
- Recovery: can re-enter service only through `initialising`
- Terminal: no, because restart is allowed

### `failed`

- Owner: Horae runtime registry
- Entry: explicit transition from `initialising`, `ready`, `busy`, `waiting`, `degraded`, or `cancelling`
- Meaning: runtime has failed and needs explicit handling
- Health requirement: none
- Prohibited transitions: direct move to `ready`, `busy`, or `waiting`
- Recovery: explicit transition to `initialising` or `terminated`
- Terminal: no, because explicit recovery is allowed

## Automatic State Changes

Implemented and tested:

- A heartbeat with status `degraded` or `unavailable` degrades a runtime that is currently `ready`, `busy`, or `waiting`.
- `markStaleRuntimes()` marks stale active runtimes as degraded.

Not automatic today:

- Recovery from degraded health back to `ready`
- Restart after termination
- Task handoff after failure

## Unsupported Candidate States

The following states were requested for review, but they are not present in the current public `RuntimeLifecycleState` type:

- `DISCOVERING`
- `PLANNING`
- `VALIDATING`
- `READY`
- `STARTING`
- `RUNNING`
- `DEGRADED`
- `PAUSING`
- `PAUSED`
- `CANCELLING`
- `COMPLETED`
- `FAILED`

Documentation note:

- Lowercase `ready`, `degraded`, `cancelling`, and `failed` are implemented as runtime lifecycle states.
- `DISCOVERING`, `PLANNING`, `VALIDATING`, `STARTING`, `RUNNING`, `PAUSING`, `PAUSED`, and `COMPLETED` are not implemented as Horae public lifecycle states today.
- `HoraeSessionStateAssessment` exposes `ready` or `degraded` as a derived session observation; it is not a session lifecycle state machine.

## Open Questions

- Whether cancellation is owned by Horae, the task owner, or the runtime itself is not fully specified beyond the current transition API.
- Whether automatic restart should be allowed for authority-bearing runtimes is unresolved.
- Whether session-level orchestration phases or transitions should exist beyond ready/degraded assessment is unresolved.
