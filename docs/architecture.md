# Architecture

Horae composes Fates runtimes without becoming their policy, execution or memory authority. Project Adrasteia owns portable representation and structural validation; Horae uses it through `@horae/adrasteia-adapter` and retains only local orchestration semantics.

```text
trusted host ── trusted request ──> Horae
                                    │
      canonical inspection <── Ananke (policy / approval / execution)
      canonical inspection <── Mnemosyne (memory / provenance / reliability)
                                    │
                          admission → reduced plan → validated session
```

## Local versus portable contracts

Portable Adrasteia contracts include runtime identity, health, readiness, registration, endpoints, capabilities, compatibility manifests, protocol ranges, dual-principal execution context, bounded scope, correlation and portable references.

Horae-local contracts include admission, lifecycle, observation freshness, profile selection, capability plans, hidden reasons, composition, sessions, degradation assessments and Horae events. A supervised registration contains the canonical peer registration plus local source, admission, lifecycle and observation facts; its local registration ID is never an authenticated runtime identity.

## Composition law

Peer registration performs canonical parsing, semantic protocol negotiation, readiness validation and local admission. It can reject malformed, unavailable, unverified, duplicate, incompatible and not-ready peers. It does not authenticate a peer or create authority.

Capability planning is monotonic reduction. A capability is selected only when its peer is admitted and fresh, reports healthy/ready, is active with available dependencies, fits the profile/request and has no provider conflict. Missing required capability rejects composition; optional capability is hidden with a deterministic reason.

Session creation validates but does not start a process, execute, approve, retrieve memory, mint a credential, enlarge scope or automatically replan/recover.
