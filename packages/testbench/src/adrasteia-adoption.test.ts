import { describe, expect, it } from "vitest";
import {
  CapabilityProviderConflictError,
  CompositionValidationError,
  HoraeRuntime,
  InMemoryAuditRouter,
  RegistrationAdmissionError,
  RuntimeLifecycleError,
  RuntimeProtocolCompatibilityError,
  RuntimeRegistry,
  SessionOrchestrator,
  SessionRequestValidationError,
  createDevelopmentSessionRequest,
  type HoraeProfile,
  type PeerInspection,
} from "@horae/runtime-core";
import { ADRASTEIA_BASELINE, buildHoraeInspection, negotiateWithHorae } from "@horae/adrasteia-adapter";
import { CompatibilityManifestSchema, RuntimeRegistrationSchema } from "project-runtime-contracts";
import { HttpAnankeInspectionBinding } from "@horae/ananke-binding";
import { CallbackMnemosyneInspectionBinding } from "@horae/mnemosyne-binding";

const timestamp = "2026-07-18T12:00:00.000Z";

const profile: HoraeProfile = {
  id: "personal-development",
  displayName: "Personal Development",
  projectId: "project-horae",
  requiredRuntimeCapabilities: ["policy", "memory"],
  optionalRuntimeCapabilities: ["audit"],
  allowedRuntimeCapabilities: ["policy", "memory", "audit"],
  auditDestinations: ["local-jsonl"],
  capabilityExposure: "progressive",
};

function candidate(input: {
  id: string;
  runtime: "ananke" | "mnemosyne" | "external";
  capabilityId: string;
  category: "policy" | "memory" | "audit";
  protocolVersion?: string;
  minimumProtocolVersion?: string;
  healthy?: boolean;
  ready?: boolean;
  exposure?: "active" | "discoverable";
  dependencyState?: "available" | "unavailable";
  instanceId?: string;
}) {
  const protocolVersion = input.protocolVersion ?? "1.4.0";
  const minimumProtocolVersion = input.minimumProtocolVersion ?? "1.0.0";
  const capability = {
    id: input.capabilityId,
    name: input.capabilityId,
    version: "0.1.0",
    category: input.category,
    exposure: input.exposure ?? "active",
    dependencyState: input.dependencyState ?? "available",
  };
  const healthy = input.healthy ?? true;
  const ready = input.ready ?? true;
  const identity = {
    runtime: input.runtime,
    version: "0.1.0",
    protocolVersion,
    minimumProtocolVersion,
    supportedProtocolRange: { minimum: minimumProtocolVersion, maximum: protocolVersion },
    instanceId: input.instanceId ?? `${input.id}-instance`,
    capabilities: [capability],
  };
  return {
    id: input.id,
    source: `pinned-${input.runtime}-inspection`,
    observedAt: timestamp,
    registration: {
      identity,
      capabilities: [capability],
      health: { healthy, status: healthy ? "healthy" : "degraded", uptimeMs: 1, warnings: [], checkedAt: timestamp },
      readiness: { ready, status: ready ? "ready" : "not_ready", dependencies: [], checkedAt: timestamp },
      endpoints: [{ id: "local", transport: "local" }],
      registeredAt: timestamp,
      inspectionMechanism: "fixture-backed pinned inspection",
    },
    compatibility: {
      manifestSchemaVersion: "1.0.0",
      runtimeName: input.runtime,
      runtimeVersion: "0.1.0",
      packageVersion: "project-runtime-contracts@0.4.0",
      protocolVersion,
      minimumSupportedProtocolVersion: minimumProtocolVersion,
      supportedProtocolRange: { minimum: minimumProtocolVersion, maximum: protocolVersion },
      requiredRuntimeContractsVersionRange: "0.4.0",
      supportedTransports: ["local"],
      capabilities: [capability],
      standalone: true,
      knownConstraints: ["inspection only"],
    },
  };
}

function plannedRegistry() {
  const registry = new RuntimeRegistry();
  registry.register(candidate({ id: "ananke", runtime: "ananke", capabilityId: "ananke.policy", category: "policy" }));
  registry.register(candidate({ id: "mnemosyne", runtime: "mnemosyne", capabilityId: "mnemosyne.memory", category: "memory" }));
  return registry;
}

describe("Project Adrasteia immutable baseline", () => {
  it("validates canonical Horae inspection and the pinned release facts", () => {
    expect(ADRASTEIA_BASELINE).toMatchObject({ packageName: "project-runtime-contracts", packageVersion: "0.4.0", protocolVersion: "1.4.0", minimumProtocolVersion: "1.0.0", contentPreflightIncluded: false });
    const inspection = buildHoraeInspection({ version: "0.1.0", instanceId: "horae-test", now: timestamp });
    expect(RuntimeRegistrationSchema.safeParse(inspection.registration).success).toBe(true);
    expect(CompatibilityManifestSchema.safeParse(inspection.compatibility).success).toBe(true);
    expect(inspection.compatibility.knownConstraints?.join(" ")).toContain("No action execution");
  });

  it("uses semantic Fates negotiation rather than exact or lexical comparison", () => {
    expect(negotiateWithHorae("1.4.0", "1.0.0")).toEqual({ compatible: true, negotiatedVersion: "1.4.0" });
    expect(negotiateWithHorae("1.0.0", "1.0.0")).toEqual({ compatible: true, negotiatedVersion: "1.0.0" });
    expect(negotiateWithHorae("2.0.0", "2.0.0")).toMatchObject({ compatible: false, reason: "unsupported_major" });
    expect(negotiateWithHorae("nope", "1.0.0")).toMatchObject({ compatible: false, reason: "malformed_version" });
  });
});

describe("admission and local supervision", () => {
  it("requires canonical evidence, unique admission ids, and distinct instances", () => {
    const registry = new RuntimeRegistry();
    const peer = candidate({ id: "ananke", runtime: "ananke", capabilityId: "ananke.policy", category: "policy" });
    registry.register(peer);
    expect(() => registry.register(peer)).toThrow(RuntimeLifecycleError);
    expect(() => registry.register({ ...peer, id: "another-admission" })).toThrow(RegistrationAdmissionError);
    expect(registry.admit({ ...peer, id: "not-ready", registration: { ...peer.registration, readiness: { ...peer.registration.readiness, ready: false, status: "not_ready" } } }).admission.state).toBe("not_ready");
    expect(registry.admit({ ...peer, id: "bad", compatibility: { ...peer.compatibility, protocolVersion: "1.3.0", supportedProtocolRange: { minimum: "1.0.0", maximum: "1.3.0" } } }).admission.state).toBe("identity_mismatch");
  });

  it("keeps peer health intact when local freshness becomes stale", () => {
    const registry = plannedRegistry();
    registry.transitionLifecycle("ananke", "initialising", { at: "2026-07-18T12:00:01.000Z" });
    registry.transitionLifecycle("ananke", "ready", { at: "2026-07-18T12:00:02.000Z" });
    const [assessment] = registry.markStaleRuntimes({ maxAgeMs: 1, now: "2026-07-18T12:00:03.000Z" });
    expect(assessment).toMatchObject({ isStale: true, freshness: "stale" });
    expect(registry.get("ananke")?.registration.health?.status).toBe("healthy");
    expect(registry.get("ananke")?.lifecycle.state).toBe("degraded");
    registry.recordHeartbeat("ananke", { healthy: true, status: "healthy", uptimeMs: 2, warnings: [], checkedAt: "2026-07-18T12:00:04.000Z" });
    expect(registry.get("ananke")?.lifecycle.state).toBe("degraded");
    expect(() => registry.recordHeartbeat("ananke", { healthy: true, status: "healthy", uptimeMs: 3, warnings: [], checkedAt: timestamp })).toThrow("out-of-order");
  });

  it("rejects protocol-incompatible peers before admission", () => {
    const registry = new RuntimeRegistry();
    const legacy = candidate({ id: "legacy", runtime: "external", capabilityId: "legacy.policy", category: "policy", protocolVersion: "2.0.0", minimumProtocolVersion: "2.0.0" });
    expect(registry.admit(legacy).admission).toMatchObject({ state: "incompatible", reasons: ["unsupported_major"] });
    expect(() => registry.register(legacy)).toThrow(RegistrationAdmissionError);
  });
});

describe("trusted composition", () => {
  it("requires dual principals, bounded scope, project consistency and profile limits", () => {
    const request = createDevelopmentSessionRequest({ projectId: profile.projectId, profileId: profile.id, task: "opaque", purpose: "composition test" });
    const registry = plannedRegistry();
    const session = new SessionOrchestrator(registry).start(request, profile);
    expect(session.id).toMatch(/^session_[0-9a-f-]{36}$/);
    expect(session.composition.id).toMatch(/^composition_[0-9a-f-]{36}$/);
    expect(session.composition.negotiatedProtocols).toEqual({ ananke: "1.4.0", mnemosyne: "1.4.0" });
    expect(() => new SessionOrchestrator(registry).start({ ...request, projectId: "wrong" }, profile)).toThrow(SessionRequestValidationError);
    expect(() => new SessionOrchestrator(registry).start({ ...request, scope: { ...request.scope, projectId: "*" } }, profile)).toThrow(SessionRequestValidationError);
    expect(() => new SessionOrchestrator(registry).start({ ...request, requestedCapabilities: ["execution"] }, profile)).toThrow(SessionRequestValidationError);
  });

  it("fails missing requirements and rejects provider conflicts", () => {
    const policyOnly = new RuntimeRegistry();
    policyOnly.register(candidate({ id: "ananke", runtime: "ananke", capabilityId: "ananke.policy", category: "policy" }));
    const request = createDevelopmentSessionRequest({ projectId: profile.projectId, profileId: profile.id, task: "opaque", purpose: "composition test" });
    expect(() => new SessionOrchestrator(policyOnly).start(request, profile)).toThrow(CompositionValidationError);
    const registry = plannedRegistry();
    registry.register(candidate({ id: "other-policy", runtime: "external", capabilityId: "ananke.policy", category: "policy" }));
    expect(() => new SessionOrchestrator(registry).start(request, profile)).toThrow(CapabilityProviderConflictError);
  });
});

describe("pinned peer inspection bindings", () => {
  const peer = candidate({ id: "fixture", runtime: "ananke", capabilityId: "ananke.policy", category: "policy" });
  const inspection: PeerInspection = {
    identity: peer.registration.identity as PeerInspection["identity"],
    health: peer.registration.health as PeerInspection["health"],
    readiness: peer.registration.readiness as PeerInspection["readiness"],
    registration: peer.registration as PeerInspection["registration"],
    compatibility: peer.compatibility as PeerInspection["compatibility"],
    inspectionMechanism: "pinned sanitized fixture",
  };

  it("uses only Ananke's documented public inspection paths", async () => {
    const calls: string[] = [];
    const payloads = [inspection.identity, inspection.health, inspection.readiness, inspection.registration, inspection.compatibility];
    const binding = new HttpAnankeInspectionBinding("https://ananke.example", async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(payloads.shift()), { status: 200, headers: { "content-type": "application/json" } });
    });
    expect((await binding.inspect()).registration.identity.runtime).toBe("ananke");
    expect(calls).toEqual([
      "https://ananke.example/api/runtime/identity",
      "https://ananke.example/api/runtime/health",
      "https://ananke.example/api/runtime/readiness",
      "https://ananke.example/api/runtime/registration",
      "https://ananke.example/api/runtime/compatibility",
    ]);
    expect("execute" in binding).toBe(false);
  });

  it("uses Mnemosyne's callback facade without invented HTTP or memory reads", async () => {
    const binding = new CallbackMnemosyneInspectionBinding(() => ({ ...inspection }));
    expect((await binding.inspect()).registration.identity.runtime).toBe("ananke");
    expect("fetch" in binding).toBe(false);
  });
});

describe("Horae inspection and audit", () => {
  it("is canonical and emits sanitized, generated local events", () => {
    const inspect = new HoraeRuntime().inspect();
    expect(RuntimeRegistrationSchema.safeParse(inspect.registration).success).toBe(true);
    expect(JSON.stringify(inspect)).not.toMatch(/token|authorization|raw task/i);
    const event = new InMemoryAuditRouter().emit({ type: "composition.created", correlation: { requestId: "req-1", correlationId: "cor-1" }, payload: { token: "hidden", capabilityCount: 2 } });
    expect(event.id).toMatch(/^event_[0-9a-f-]{36}$/);
    expect(event.payload).toEqual({ capabilityCount: 2 });
  });
});
