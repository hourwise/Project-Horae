# Project Adrasteia Stage-A composition boundary

Horae consumes the immutable `project-runtime-contracts@0.4.0` release recorded in [adrasteia-baseline.json](adrasteia-baseline.json). `@horae/adrasteia-adapter` is pure mapping, canonical parsing, baseline verification and semantic protocol negotiation.

Peer registration first parses canonical inspection evidence, then performs Horae-local admission. A supervised registration keeps a peer-reported health/readiness snapshot separate from Horae's lifecycle and freshness observation. Discovery, compatibility, admission, a capability declaration, a state handle, a correlation ID and historical approval references are never action authority.

Pinned Ananke composition uses only the documented public inspection endpoints. Pinned Mnemosyne composition uses its transport-neutral facade or MCP inspection tool; Horae does not invent an HTTP surface. Both bindings are inspection-only and do not execute actions, approve work, retrieve memory or store credentials.

Session requests require a trusted host to provide distinct authenticated human/service and acting-agent principals, bounded project scope, purpose, request ID and correlation ID. Capability planning only reduces: unadmitted, stale, unhealthy, not-ready, hidden, dependency-unavailable, profile-disallowed and conflicting providers are excluded.

Content preflight is not part of this Stage-A baseline. The existing Horae preflight ADR remains Proposed and Deferred.
