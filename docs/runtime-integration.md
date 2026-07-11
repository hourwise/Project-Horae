# Runtime Integration

## Shared Contracts and Admission

`project-runtime-contracts` is the protocol source for cross-runtime message shapes. Horae-local planning types live in `@horae/schema`. Neither layer makes approval, policy, memory-trust, provider, or credential decisions.

Before a runtime joins a governed session, Horae verifies authenticated identity, supported protocol version, message schema, capabilities, health/readiness, and duplicate or conflicting providers. Local transport alone is not a trust boundary.

Every cross-runtime envelope needs session binding, correlation IDs, timestamp or sequence handling, replay protection, idempotency handling, and an auditable rejection path for stale, duplicate, malformed, or impersonated messages.

## Runtime Capability Manifest

Each runtime declares a stable identity, version, supported protocols, health, and capabilities. Capabilities include a stable ID, owner, risk/sensitivity, route type, required profile tags, disclosure boundary, validation status, and whether they require Ananke governance or Mnemosyne context.

Horae rejects incompatible combinations before task execution. It does not use a runtime's identity as evidence that every output from that runtime is trustworthy.

## Ananke Boundary

Horae asks Ananke for identity, protocol support, health, policy profiles, approval and execution routes, typed outcomes, and audit-record references. All execution-sensitive effects must use Ananke's exclusive governed routes.

Horae may request an approval but cannot approve, bind, reinterpret, or bypass it. It must preserve approval invalidation when the approved payload or relevant context changes.

## Mnemosyne Boundary

Horae asks Mnemosyne for identity, protocol support, health, available scopes, qualified context packs, citations, provenance, and reliability/conflict signals.

Horae carries those signals into composition and governance decisions but never changes reliability, resolves conflicts as truth, or turns its own timeline into Mnemosyne's memory record.

## Model Broker Boundary

Horae consumes a normalised model profile from a separate Model Broker. The profile includes provider and model identity, local/remote and jurisdiction boundary, validated capabilities, context limit, structured-output support, tool-call reliability, model digest when available, privacy properties, and permitted fallback models.

Horae decides whether that model may participate under the active task and disclosure constraints. The broker decides how to communicate with it. Missing or unvalidated required capabilities cause composition to fail.

## Connector and Credential Boundary

External systems are typed capability providers, for example `github.issues.read`, `github.contents.read`, `github.branch.push`, and `github.pull_request.create`. Workspace access, local Git, and remote GitHub are separate routes.

Credential custody belongs to a credential broker or connector-specific secure component. Horae holds no raw tokens; models receive no credentials; unrestricted shell access cannot substitute for typed connector routes.

## Data Disclosure and Fallback

The active profile declares what data may cross a boundary, such as source code, repository history, customer data, personal data, secrets, Mnemosyne context, and tool results. Sending data to a hosted model is a governed disclosure action. If model and task boundaries conflict, Horae fails composition before transfer.

Fallback is explicit and allowed only if it preserves or strengthens data locality, privacy, permissions, governance, and validated capabilities. It may not silently change a local model to hosted, jurisdiction, endpoint, or restrictions.

## Lifecycle, Failure, and Storage

Horae supervises runtime startup, shutdown, restart, and health transitions. It uses a capability- and risk-specific degraded plan: for example Ananke unavailability denies writes, while Mnemosyne unavailability may permit a low-risk search with a warning but blocks or escalates high-risk work.

Every runtime uses separate storage; a future project layout places independent data under `.project-moirae/ananke/`, `.project-moirae/mnemosyne/`, `.project-moirae/horae/`, `model-profiles/`, `connectors/`, and `validation-reports/`. Secrets remain outside project storage in operating-system credential custody.
