# Project Horae

Horae is a TypeScript composition and supervision runtime for the Fates ecosystem. It has adopted the immutable Project Adrasteia Stage-A baseline: `project-runtime-contracts@0.4.0`, Fates Runtime Protocol 1.4.0, with semantic compatibility across 1.0.0–1.4.0.

Horae owns discovery, admission, capability reduction, composition planning, session identity, local lifecycle/freshness supervision, degradation assessment and cross-runtime correlation. It does not own policy, approval, governed execution, memory truth, provenance, qualified retrieval, provider routing, credentials or another runtime's audit authority.

## Current Stage-A Surface

| Package | Evidence |
| --- | --- |
| `@horae/adrasteia-adapter` | Pure canonical parsing, semantic negotiation, Horae inspection and baseline validation |
| `@horae/runtime-registry` | Separate canonical peer registration from local admission, lifecycle and freshness |
| `@horae/capability-planner` | Readiness/exposure/dependency-aware capability reduction and deterministic conflict rejection |
| `@horae/session-orchestrator` | Trusted dual-principal request validation, bounded scope, UUID session/composition identities |
| `@horae/ananke-binding` | Read-only binding to documented public Ananke inspection endpoints |
| `@horae/mnemosyne-binding` | Read-only callback binding for Mnemosyne's transport-neutral inspection facade |
| `@horae/cli` | `inspect --json`, `validate-baseline`, and `negotiate` evidence commands |

`horae inspect --json` exposes a sanitized, Adrasteia-valid description. It does not expose credentials, paths, raw task text, peer memory or action arguments.

## Important boundaries

- Discovery, compatibility, admission, health, capability declarations, references and correlation never grant action authority.
- Ananke remains the sole action-policy, approval and governed-execution authority.
- Mnemosyne remains the sole memory, provenance, reliability and qualified-context authority.
- Capability planning may reduce availability but never silently expands it.
- Peer health/readiness remains peer-reported; Horae's lifecycle and freshness are local facts.
- Content preflight is excluded from the pinned Stage-A baseline. The existing preflight ADR remains Proposed/Deferred.

## Verification

```bash
npm ci
npm run validate
npm audit --omit=dev
```

Useful focused commands:

```bash
npm run verify:adrasteia
npm run test:ananke:comparator
npm run test:mnemosyne:comparator
npm run test:cli
node packages/cli/dist/index.js inspect --json
```

The exact artifact, digest and peer pins are in [the Stage-A baseline](docs/integration/adrasteia-baseline.json). See [the composition boundary](docs/integration/stage-a-composition.md) and [ADR-0001](docs/decisions/ADR-0001-project-adrasteia-stage-a-composition-boundary.md) for limits and rollback.
