# Project Horae

Horae is a TypeScript workspace for a composition and supervision runtime in the Moirae ecosystem.

The current repository contains:

- implemented and tested runtime-registration lifecycle logic in `@horae/runtime-registry`;
- implemented and tested capability planning and session scaffolding in `@horae/capability-planner`, `@horae/session-orchestrator`, and `@horae/runtime-core`;
- implemented but minimal bindings and audit scaffolding in `@horae/ananke-binding`, `@horae/mnemosyne-binding`, `@horae/gateway-adapter`, and `@horae/audit-router`;
- design and planning documents for broader composition, governance, degradation, correlation, and recovery behavior.

The official IDE name is **Moirae Code**. Use that name consistently in repository documentation and user-facing copy.

## What Horae Owns

Horae owns runtime discovery, capability matching, compatibility negotiation, composition planning, lifecycle supervision where implemented, health aggregation, orchestration state, cross-runtime correlation, and degradation or recovery coordination.

Horae does not own action approval or policy, approval creation, memory reliability or truth, runtime-owned authoritative audit, raw provider credentials, direct tool authority, or permission escalation.

The governing rule is: **coordination may reduce capability, but must never silently expand it.**

## Current Code Surface

| Package                       | Current repository evidence                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@horae/schema`               | Exported runtime, health, lifecycle, capability, profile, session, and event types                     |
| `@horae/runtime-registry`     | Registration, lifecycle transitions, heartbeat recording, stale-heartbeat degradation, deregistration  |
| `@horae/capability-planner`   | Capability filtering for healthy registrations based on requested capabilities or profile requirements |
| `@horae/session-orchestrator` | Session scaffolding from a request, profile, and current registry state                                |
| `@horae/audit-router`         | In-memory event collection                                                                             |
| `@horae/ananke-binding`       | `inspect()` interface only                                                                             |
| `@horae/mnemosyne-binding`    | `inspect()` interface only                                                                             |
| `@horae/gateway-adapter`      | `inspect()` interface only                                                                             |
| `@horae/cli`                  | Scaffold command surface for `inspect`, `register`, `plan`, `session`, and `graph`                     |
| `@horae/testbench`            | Lifecycle and orchestration scaffold tests                                                             |

## Documentation

- [Architecture](docs/architecture.md)
- [Laws of Horae](docs/laws-of-horae.md)
- [Composition Model](docs/composition-model.md)
- [Supervision State Machine](docs/supervision-state-machine.md)
- [Degradation and Recovery](docs/degradation-and-recovery.md)
- [Correlation Model](docs/correlation-model.md)
- [Ownership Matrix](docs/architecture/ownership-matrix.md)
- [Runtime Integration](docs/runtime-integration.md)
- [Implementation Plan](docs/implementation-plan.md)
- [Roadmap](docs/roadmap.md)
- [Research and Requirements](docs/PROJECT_HORAE_RESEARCH_AND_REQUIREMENTS.md)
- [Decision Index](docs/decisions/README.md)
- [Open Design Questions](docs/notes/open-design-questions.md)

## Status

Implemented and tested:

- runtime registration and duplicate-registration rejection;
- lifecycle transition validation for `registered`, `initialising`, `ready`, `busy`, `waiting`, `degraded`, `cancelling`, `terminated`, and `failed`;
- stale-heartbeat assessment and stale-runtime degradation;
- task ownership retention across active and degraded runtime states;
- capability planning from profile requirements and healthy registrations;
- session scaffolding for Ananke and Mnemosyne registrations.

Implemented but still scaffold-level:

- binding interfaces for Ananke, Mnemosyne, and gateway inspection;
- in-memory audit event collection;
- CLI command surface beyond `help`.

Designed or proposed in documentation, but not implemented in the current public code:

- protocol negotiation and compatibility enforcement;
- governed execution and approval binding through Ananke;
- qualified context-pack retrieval and memory reliability handling through Mnemosyne;
- typed aggregate outcomes such as `PARTIAL_SUCCESS` and `RECOVERABLE_RETRY`;
- provider and connector routing;
- mandatory Content Surface Preflight routing from the proposed ADR.

## Development

Run tests:

```bash
npm test
```

Run the current testbench only:

```bash
npm run test:bench
```

Build the workspace:

```bash
npm run build
```
