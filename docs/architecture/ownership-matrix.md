# Ownership Matrix

This matrix records which component owns each concern and what Horae may do without crossing that boundary.

## Repository Evidence

- [README.md](../../README.md)
- [architecture.md](../architecture.md)
- Public package boundaries under [`packages/`](../../packages)

## Ownership Matrix

| Concern                       | Primary owner                                   | Horae may do                                                                               | Horae must not do                                                 | Status                                                                  |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Runtime discovery             | Horae                                           | Register, list, and inspect runtime registrations                                          | Treat local presence as trust by itself                           | Implemented and tested at basic registry level                          |
| Capability matching           | Horae                                           | Build capability plans and reject duplicate selected IDs                                   | Expose every capability by default or select equivalent providers | Implemented and tested                                                  |
| Compatibility negotiation     | Horae                                           | Compare selected runtime `protocolVersion` values with the expected Horae protocol version | Claim identity, feature, or range negotiation not implemented     | Implemented and tested                                                  |
| Composition planning          | Horae                                           | Create plans, composition identities, session scaffolds, and derived state                 | Treat a session scaffold as governed execution or silently replan | Implemented and tested at scaffold level                                |
| Memory provenance and truth   | Mnemosyne                                       | Request or carry memory-related capability references                                      | Rewrite provenance or decide truth of conflicting memory          | Designed boundary, not implemented in current binding                   |
| Policy evaluation             | Ananke                                          | Route future policy requests                                                               | Decide policy locally                                             | Designed boundary, not implemented in current binding                   |
| Approval creation and binding | Ananke                                          | Request approval in future designs                                                         | Manufacture, widen, or reinterpret approval                       | Designed boundary, not implemented in current binding                   |
| Governed execution            | Ananke plus connector or executor path          | Compose future governed execution routes                                                   | Call executors directly through Horae-owned public code           | Designed boundary, not implemented in current binding                   |
| Provider transport            | Model Broker                                    | Consume future model capability profiles                                                   | Call provider-specific APIs directly from Horae                   | Designed                                                                |
| Connector transport           | Connector or gateway provider                   | Discover and route future typed connector capability providers                             | Hold raw tokens or substitute unrestricted shell authority        | Designed                                                                |
| Credentials                   | Credential broker or connector-specific custody | Reference destinations and future capability needs                                         | Store or expose raw provider credentials                          | Designed                                                                |
| Runtime-owned audit           | Producing runtime                               | Correlate or reference records                                                             | Rewrite another runtime's authoritative audit as Horae truth      | Accepted boundary                                                       |
| Correlated timeline           | Horae                                           | Emit and collect Horae events                                                              | Present timeline correlation as authority                         | Implemented at in-memory scaffold level                                 |
| UI presentation               | Moirae Code or other host UI                    | Supply state for display                                                                   | Treat UI presence as authority grant                              | Designed                                                                |
| Recovery coordination         | Horae                                           | Track lifecycle degradation and explicit recovery transitions                              | Retry completed external effects without a recovery contract      | Implemented at runtime lifecycle level; task-level recovery is designed |

## Documentation Conflict

- Some older repository prose describes broader owned behavior for compatibility, governed execution, aggregate outcomes, and audit correlation than the current public code proves. This matrix follows code and tests first, then design docs.
