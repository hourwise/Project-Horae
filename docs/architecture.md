# Architecture

This document gives the high-level repository architecture and points to the more detailed companion documents.

## Overview

Horae is a composition and supervision runtime for governed runtimes in the Moirae ecosystem.

In the current repository, Horae publicly models:

- runtime identity and health records;
- runtime lifecycle state and task ownership;
- capability registration and filtering;
- session scaffolding;
- in-memory event correlation.

Broader governance, execution, model, connector, and recovery behavior is still design-stage unless a package and test in this repository proves otherwise.

## Ownership Boundary

| Component                      | Owns                                                                                                                                                     | Horae does not own                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Horae                          | discovery, capability matching, composition planning, lifecycle supervision where implemented, health aggregation, correlation, degradation coordination | approval creation, memory truth, provider transport, raw credentials |
| Ananke                         | policy, approval, governed execution, action outcomes, runtime-owned action audit                                                                        | composition planning                                                 |
| Mnemosyne                      | memory provenance, reliability, conflicts, freshness, qualified context                                                                                  | policy or truth assignment by Horae                                  |
| Model Broker                   | provider-specific transport and model profile normalisation                                                                                              | task composition                                                     |
| Connector or credential broker | external operations and credential custody                                                                                                               | model-visible credentials                                            |

See [architecture/ownership-matrix.md](architecture/ownership-matrix.md) for the detailed matrix.

## Current Package Shape

```text
Moirae Code or another host
            |
          Horae
   +--------+--------+--------+
   |                 |        |
registry         planner   session scaffold
   |                 |        |
 runtime         capability   correlation
 records          selection    and events
```

This package shape is implemented today through:

- [`packages/runtime-registry`](../packages/runtime-registry)
- [`packages/capability-planner`](../packages/capability-planner)
- [`packages/session-orchestrator`](../packages/session-orchestrator)
- [`packages/runtime-core`](../packages/runtime-core)
- [`packages/audit-router`](../packages/audit-router)

## Companion Documents

- [Laws of Horae](laws-of-horae.md)
- [Composition Model](composition-model.md)
- [Supervision State Machine](supervision-state-machine.md)
- [Degradation and Recovery](degradation-and-recovery.md)
- [Correlation Model](correlation-model.md)
- [Runtime Integration](runtime-integration.md)
- [Implementation Plan](implementation-plan.md)
- [Roadmap](roadmap.md)

## Documentation Conflict

- Older repository prose previously described broader implemented orchestration than the current public code supports. This architecture summary follows public types, source code, and tests first.
