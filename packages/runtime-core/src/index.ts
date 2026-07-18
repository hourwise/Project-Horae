import { randomUUID } from "node:crypto";
import { buildHoraeInspection, negotiateWithHorae } from "@horae/adrasteia-adapter";

export { InMemoryAuditRouter } from "@horae/audit-router";
export { RuntimeLifecycleError, RuntimeProtocolCompatibilityError, RegistrationAdmissionError, RuntimeRegistry } from "@horae/runtime-registry";
export type { LifecycleTransitionOptions, PeerRegistrationCandidate, ProtocolNegotiationResult, RuntimeHealthAssessment, StaleHeartbeatOptions } from "@horae/runtime-registry";
export { CapabilityProviderConflictError, SessionOrchestrator, CompositionValidationError, SessionRequestValidationError, createDevelopmentSessionRequest, validateTrustedSessionRequest, DEFAULT_HORAE_PROTOCOL_VERSION } from "@horae/session-orchestrator";
export type { CapabilityProviderConflict, SessionOrchestratorOptions } from "@horae/session-orchestrator";
export type {
  AgentExecutionContext,
  Capability,
  CompatibilityManifest,
  CorrelationContext,
  HoraeCapabilityPlan,
  HoraeComposition,
  HoraeEvent,
  HoraeProfile,
  HoraeSession,
  HoraeSessionRequest,
  HoraeSessionState,
  HoraeSessionStateAssessment,
  PeerInspection,
  RegistrationAdmission,
  ResourceScope,
  RuntimeHealth,
  RuntimeLifecycle,
  RuntimeLifecycleState,
  RuntimeObservation,
  RuntimeReadiness,
  RuntimeRegistration,
  SupervisedRuntimeRegistration,
} from "@horae/schema";

/** Horae's transport-neutral, canonical inspection facade. */
export class HoraeRuntime {
  private readonly instanceId = `horae_${randomUUID()}`;

  constructor(
    private readonly version = "0.1.0",
    private readonly ready = true,
  ) {}

  runtimeIdentity() { return buildHoraeInspection({ version: this.version, instanceId: this.instanceId, ready: this.ready }).identity; }
  runtimeHealth() { return buildHoraeInspection({ version: this.version, instanceId: this.instanceId, ready: this.ready }).health; }
  runtimeReadiness() { return buildHoraeInspection({ version: this.version, instanceId: this.instanceId, ready: this.ready }).readiness; }
  runtimeRegistration() { return buildHoraeInspection({ version: this.version, instanceId: this.instanceId, ready: this.ready }).registration; }
  compatibilityManifest() { return buildHoraeInspection({ version: this.version, instanceId: this.instanceId, ready: this.ready }).compatibility; }
  inspect() {
    const snapshot = buildHoraeInspection({ version: this.version, instanceId: this.instanceId, ready: this.ready });
    return { ...snapshot, constraints: snapshot.compatibility.knownConstraints ?? [] };
  }
  negotiateProtocol(protocolVersion: string, minimumProtocolVersion: string) {
    return negotiateWithHorae(protocolVersion, minimumProtocolVersion);
  }
}
