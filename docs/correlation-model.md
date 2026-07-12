# Correlation Model

This document records the identifiers that exist in current public code and separates them from identifiers that are only designed in repository prose.

## Repository Evidence

- Public schema in [`packages/schema/src/index.ts`](../packages/schema/src/index.ts)
- Session creation in [`packages/session-orchestrator/src/index.ts`](../packages/session-orchestrator/src/index.ts)
- Audit event collection in [`packages/audit-router/src/index.ts`](../packages/audit-router/src/index.ts)
- Lifecycle behavior in [`packages/runtime-registry/src/index.ts`](../packages/runtime-registry/src/index.ts)

## Correlation Rule

Correlation connects records. It does not grant authority, approve actions, validate truth, or replace runtime-owned audit.

## Implemented Identifier Surface

| Identifier                | Status      | Owner                                              | Generation                                              | Propagation                                                                  | Cardinality                          | Persistence                                          | Privacy note                                                             |
| ------------------------- | ----------- | -------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `HoraeSession.id`         | Implemented | Horae `SessionOrchestrator`                        | Created by `start()` as `session_${Date.now()}`         | Stored on `HoraeSession`; may be copied into `HoraeEvent.sessionId`          | One per created session              | In-memory session object unless a caller persists it | Avoid relying on the current string format as a stable external contract |
| `HoraeComposition.id`     | Implemented | Horae `SessionOrchestrator`                        | Created by `start()` as `composition_${Date.now()}`     | Stored on `HoraeSession.composition` and assessment results                  | One per created session composition  | In-memory session object unless a caller persists it | Distinct from session ID; does not establish recovery continuity         |
| `HoraeEvent.id`           | Implemented | Event emitter                                      | Supplied by the caller when emitting an event           | Stored by `InMemoryAuditRouter`                                              | One per event                        | In-memory only in current audit router               | Event IDs may indirectly expose task structure if emitted carelessly     |
| `HoraeEvent.sessionId`    | Implemented | Event emitter                                      | Optional caller-supplied link to a session              | Stored by `InMemoryAuditRouter`                                              | Many events may share one session ID | In-memory only in current audit router               | Correlates events but grants nothing                                     |
| `HoraeEvent.runtimeId`    | Implemented | Event emitter                                      | Optional caller-supplied link to a runtime registration | Stored by `InMemoryAuditRouter`                                              | Many events may share one runtime ID | In-memory only in current audit router               | Should not be treated as runtime proof by itself                         |
| `RuntimeRegistration.id`  | Implemented | Registration submitter, enforced by Horae registry | Supplied at registration time                           | Used across registry lookup, lifecycle transitions, and capability ownership | One per active registration entry    | Registry memory only in current public code          | A local string ID is not an authenticated identity on its own            |
| `RuntimeLifecycle.taskId` | Implemented | Task owner recorded through lifecycle transitions  | Set when entering `busy`                                | Retained across `waiting`, `degraded`, `cancelling`, and some failure paths  | One active owner per busy runtime    | Registry memory only in current public code          | Identifies ownership, not approval scope                                 |

## Designed Identifier Surface

The following identifiers are described in current repository prose, but they are not yet public code in `@horae/schema`:

| Identifier                                                                     | Current status | Source                                                                               |
| ------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------ |
| `ecosystemSessionId`                                                           | Designed       | [architecture.md](architecture.md), [runtime-integration.md](runtime-integration.md) |
| `taskId` as cross-runtime identifier distinct from runtime lifecycle ownership | Designed       | [architecture.md](architecture.md), [runtime-integration.md](runtime-integration.md) |
| `runtimeSessionId`                                                             | Designed       | [architecture.md](architecture.md)                                                   |
| `actionId`                                                                     | Designed       | [architecture.md](architecture.md)                                                   |
| `contextPackId`                                                                | Designed       | [architecture.md](architecture.md)                                                   |
| `approvalId`                                                                   | Designed       | [architecture.md](architecture.md), proposed ADR                                     |
| `connectorOperationId`                                                         | Designed       | [architecture.md](architecture.md)                                                   |
| `modelInvocationId`                                                            | Designed       | [architecture.md](architecture.md)                                                   |

## Requested but Not Yet Represented

These identifier classes were requested for documentation, but the repository does not yet expose them as public types:

- trace identifier separate from event ID;
- proposal identifier;
- execution identifier;
- outcome identifier;
- provider-request identifier.

## Persistence Model

Implemented:

- session IDs live in the returned `HoraeSession` object;
- composition IDs live in `HoraeSession.composition` and `HoraeSessionStateAssessment` objects;
- runtime registration and lifecycle IDs live in `RuntimeRegistry`;
- audit event IDs live only in `InMemoryAuditRouter`.

Not implemented:

- durable storage for correlation records;
- privacy or retention controls for correlation records;
- cross-runtime persistence contracts that would allow recovery after Horae restarts.

## Privacy and Authority Boundaries

- Correlation IDs should be treated as metadata, not as credentials.
- A correlation ID can associate records across systems, so it should still be handled as potentially sensitive operational data.
- A record that carries `sessionId`, `compositionId`, `runtimeId`, or a future `approvalId` does not inherit approval or trust from that identifier alone.

## Open Questions

- Whether correlation should use one global session root or several linked roots is unresolved.
- Whether composition identity should survive degraded replanning is unresolved.
- Whether provider requests need their own first-class identifier or can reuse execution-level identifiers is unresolved.
