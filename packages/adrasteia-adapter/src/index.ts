import {
  AgentExecutionContextSchema,
  CapabilitySchema,
  CompatibilityManifestSchema,
  CorrelationContextSchema,
  ResourceScopeMode,
  PrincipalKind,
  ResourceScopeSchema,
  RuntimeHealthSchema,
  RuntimeIdentitySchema,
  RuntimeKind,
  RuntimeReadinessSchema,
  RuntimeReadinessStatus,
  RuntimeRegistrationSchema,
  RuntimeTransport,
  negotiateDetailed,
  type AgentExecutionContext,
  type Capability,
  type CompatibilityManifest,
  type CorrelationContext,
  type ResourceScope,
  type RuntimeHealth,
  type RuntimeIdentity,
  type RuntimeReadiness,
  type RuntimeRegistration,
} from "project-runtime-contracts";

export { PrincipalKind, ResourceScopeMode };

export const ADRASTEIA_BASELINE = Object.freeze({
  repository: "https://github.com/hourwise/Project-Adrasteia",
  tag: "adrasteia-adoption-v0.4.0-protocol-1.4.0",
  commit: "124b6aee2629a3147739934ad5f1b45b32c8ba46",
  packageName: "project-runtime-contracts",
  packageVersion: "0.4.0",
  protocolVersion: "1.4.0",
  minimumProtocolVersion: "1.0.0",
  artifactUrl:
    "https://github.com/hourwise/Project-Adrasteia/releases/download/adrasteia-adoption-v0.4.0-protocol-1.4.0/project-runtime-contracts-0.4.0.tgz",
  artifactSha256: "11ee062b079f74d2a4558af315c9b9b12a6aede291d409c48f038d93c416e2c2",
  contentPreflightIncluded: false,
});

export type {
  AgentExecutionContext,
  Capability,
  CompatibilityManifest,
  CorrelationContext,
  ResourceScope,
  RuntimeHealth,
  RuntimeIdentity,
  RuntimeReadiness,
  RuntimeRegistration,
};

export function parseRuntimeIdentity(value: unknown): RuntimeIdentity {
  return RuntimeIdentitySchema.parse(value);
}

export function parseRuntimeHealth(value: unknown): RuntimeHealth {
  return RuntimeHealthSchema.parse(value);
}

export function parseRuntimeReadiness(value: unknown): RuntimeReadiness {
  return RuntimeReadinessSchema.parse(value);
}

export function parseRuntimeRegistration(value: unknown): RuntimeRegistration {
  return RuntimeRegistrationSchema.parse(value);
}

export function parseCompatibilityManifest(value: unknown): CompatibilityManifest {
  return CompatibilityManifestSchema.parse(value);
}

export function parseCapability(value: unknown): Capability {
  return CapabilitySchema.parse(value);
}

export function parseExecutionContext(value: unknown): AgentExecutionContext {
  return AgentExecutionContextSchema.parse(value);
}

export function parseResourceScope(value: unknown): ResourceScope {
  const scope = ResourceScopeSchema.parse(value);
  rejectWildcards(scope, "scope");
  return scope;
}

export function parseCorrelation(value: unknown): CorrelationContext {
  const correlation = CorrelationContextSchema.parse(value);
  rejectWildcards(correlation, "correlation");
  return correlation;
}

export interface ProtocolNegotiation {
  compatible: boolean;
  negotiatedVersion?: string;
  reason?: string;
}

/** Canonical semantic negotiation, never lexical string comparison. */
export function negotiateProtocol(
  localVersion: string,
  localMinimum: string,
  peerVersion: string,
  peerMinimum: string,
): ProtocolNegotiation {
  return negotiateDetailed(localVersion, localMinimum, peerVersion, peerMinimum);
}

export function negotiateWithHorae(
  peerVersion: string,
  peerMinimum: string,
): ProtocolNegotiation {
  return negotiateProtocol(
    ADRASTEIA_BASELINE.protocolVersion,
    ADRASTEIA_BASELINE.minimumProtocolVersion,
    peerVersion,
    peerMinimum,
  );
}

export function assertBoundedScope(scope: ResourceScope, projectId: string): ResourceScope {
  if (scope.mode !== ResourceScopeMode.Bounded || !scope.projectId) {
    throw new TypeError("Horae session scope must be bounded and include projectId");
  }
  if (scope.projectId !== projectId) {
    throw new TypeError("Horae session scope projectId must equal request projectId");
  }
  return scope;
}

export function assertContextConsistency(
  execution: AgentExecutionContext,
  scope: ResourceScope,
  projectId: string,
): void {
  if (execution.authenticatedPrincipal.kind !== "human" && execution.authenticatedPrincipal.kind !== "service") {
    throw new TypeError("Horae authenticated principal must be human or service");
  }
  if (execution.actingPrincipal.kind !== "agent") {
    throw new TypeError("Horae acting principal must be an agent");
  }
  assertBoundedScope(scope, projectId);
  const projects = [execution.projectId, scope.projectId, projectId].filter(Boolean);
  if (new Set(projects).size !== 1) {
    throw new TypeError("Horae request project identifiers must agree");
  }
  const tenants = [
    execution.tenantId,
    execution.authenticatedPrincipal.tenantId,
    execution.actingPrincipal.tenantId,
    scope.tenantId,
  ].filter(Boolean);
  if (new Set(tenants).size > 1) {
    throw new TypeError("Horae request tenant identifiers must agree");
  }
}

export function assertBaseline(value: Partial<typeof ADRASTEIA_BASELINE>): void {
  for (const [key, expected] of Object.entries(ADRASTEIA_BASELINE)) {
    if (key in value && value[key as keyof typeof ADRASTEIA_BASELINE] !== expected) {
      throw new TypeError(`Adrasteia baseline mismatch for ${key}`);
    }
  }
}

/** Builds Horae's descriptive, canonical inspection surface. */
export function buildHoraeInspection(input: {
  version: string;
  instanceId: string;
  now?: string;
  ready?: boolean;
}): {
  identity: RuntimeIdentity;
  health: RuntimeHealth;
  readiness: RuntimeReadiness;
  registration: RuntimeRegistration;
  compatibility: CompatibilityManifest;
} {
  const now = input.now ?? new Date().toISOString();
  const capabilities = [
    { id: "horae.registration-admission", name: "Registration admission", version: input.version, category: "registry", exposure: "active" },
    { id: "horae.capability-planning", name: "Capability planning", version: input.version, category: "session", exposure: "active" },
    { id: "horae.composition-validation", name: "Composition validation", version: input.version, category: "session", exposure: "active" },
    { id: "horae.lifecycle-supervision", name: "Lifecycle supervision", version: input.version, category: "health", exposure: "active" },
    { id: "horae.protocol-negotiation", name: "Protocol negotiation", version: input.version, category: "gateway", exposure: "active" },
    { id: "horae.runtime-inspection", name: "Runtime inspection", version: input.version, category: "health", exposure: "active" },
    { id: "horae.correlation-routing", name: "Correlation routing", version: input.version, category: "other", exposure: "active" },
  ].map(parseCapability);
  const identity = parseRuntimeIdentity({
    runtime: "horae",
    kind: RuntimeKind.Horae,
    displayName: "Horae Composition Runtime",
    version: input.version,
    packageVersion: input.version,
    protocolVersion: ADRASTEIA_BASELINE.protocolVersion,
    minimumProtocolVersion: ADRASTEIA_BASELINE.minimumProtocolVersion,
    supportedProtocolRange: { minimum: ADRASTEIA_BASELINE.minimumProtocolVersion, maximum: ADRASTEIA_BASELINE.protocolVersion },
    instanceId: input.instanceId,
    standalone: true,
    capabilities,
    metadata: { annotations: { runtimeContracts: `${ADRASTEIA_BASELINE.packageName}@${ADRASTEIA_BASELINE.packageVersion}` } },
  });
  const ready = input.ready ?? true;
  const health = parseRuntimeHealth({
    healthy: ready,
    status: ready ? "healthy" : "degraded",
    uptimeMs: 0,
    warnings: ready ? [] : ["Horae is not accepting composition work."],
    checkedAt: now,
  });
  const readiness = parseRuntimeReadiness({
    ready,
    status: ready ? RuntimeReadinessStatus.Ready : RuntimeReadinessStatus.NotReady,
    checkedAt: now,
    dependencies: [{ dependencyId: "project-runtime-contracts", status: RuntimeReadinessStatus.Ready, required: true }],
  });
  const registration = parseRuntimeRegistration({
    identity,
    capabilities,
    health,
    readiness,
    endpoints: [
      { id: "horae-cli", transport: RuntimeTransport.Cli, command: "horae", args: ["inspect", "--json"] },
      { id: "horae-embedded", transport: RuntimeTransport.Local, protocol: "transport-neutral" },
    ],
    registeredAt: now,
    inspectionMechanism: "transport-neutral runtime facade and CLI inspection",
    standalone: true,
    degradedModes: ["inspection-only peer bindings", "no automatic recovery", "no durable orchestration state"],
  });
  const compatibility = parseCompatibilityManifest({
    manifestSchemaVersion: "1.0.0",
    runtimeName: "horae",
    runtimeVersion: input.version,
    packageVersion: `${ADRASTEIA_BASELINE.packageName}@${ADRASTEIA_BASELINE.packageVersion}`,
    protocolVersion: ADRASTEIA_BASELINE.protocolVersion,
    minimumSupportedProtocolVersion: ADRASTEIA_BASELINE.minimumProtocolVersion,
    preferredProtocolVersion: ADRASTEIA_BASELINE.protocolVersion,
    supportedProtocolRange: { minimum: ADRASTEIA_BASELINE.minimumProtocolVersion, maximum: ADRASTEIA_BASELINE.protocolVersion },
    requiredRuntimeContractsVersionRange: ADRASTEIA_BASELINE.packageVersion,
    supportedTransports: [RuntimeTransport.Cli, RuntimeTransport.Local],
    capabilities,
    standalone: true,
    knownConstraints: [
      "No action execution, approval, memory retrieval, credential brokering, provider routing, or automatic recovery.",
      "Peer bindings are inspection-only and no durable orchestration state exists.",
      "Content preflight is excluded from Project Adrasteia Stage-A.",
      "Horae makes no Moirae Code integration claim.",
    ],
    degradedModes: ["optional peer unavailability hides capability", "binding failures remain unavailable observations"],
    testedPeers: [
      { runtime: "ananke", protocolVersion: "1.4.0", result: "compatible" },
      { runtime: "mnemosyne", protocolVersion: "1.4.0", result: "compatible" },
    ],
  });
  return { identity, health, readiness, registration, compatibility };
}

function rejectWildcards(value: unknown, label: string): void {
  if (typeof value === "string" && /[*!?\[\]]/.test(value)) {
    throw new TypeError(`${label} cannot contain wildcard values`);
  }
  if (Array.isArray(value)) value.forEach((entry) => rejectWildcards(entry, label));
  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => rejectWildcards(entry, label));
  }
}
