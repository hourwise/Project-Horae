/**
 * Horae-owned contracts. Portable Fates Runtime Protocol values are re-exported
 * from Project Adrasteia; supervision and orchestration remain local here.
 */
import type {
  AgentExecutionContext,
  Capability,
  CompatibilityManifest,
  CorrelationContext,
  ResourceScope,
  RuntimeHealth,
  RuntimeIdentity,
  RuntimeReadiness,
  RuntimeRegistration,
} from "project-runtime-contracts";

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

export type RuntimeLifecycleState =
  | "registered"
  | "initialising"
  | "ready"
  | "busy"
  | "waiting"
  | "degraded"
  | "cancelling"
  | "terminated"
  | "failed";

export interface RuntimeLifecycle {
  state: RuntimeLifecycleState;
  changedAt: string;
  taskId?: string;
  cancellationRequestedAt?: string;
  message?: string;
}

export type RuntimeFreshness = "fresh" | "stale" | "unavailable";

/** Horae's observation of a peer, intentionally separate from peer reports. */
export interface RuntimeObservation {
  observedAt: string;
  sourceCheckedAt?: string;
  freshness: RuntimeFreshness;
  ageMs: number;
  bindingAvailable: boolean;
  message?: string;
}

export type RegistrationAdmissionState =
  | "admitted"
  | "constrained"
  | "rejected"
  | "unavailable"
  | "malformed"
  | "incompatible"
  | "identity_mismatch"
  | "duplicate"
  | "not_ready"
  | "unsupported_integration"
  | "unverified_source";

export interface RegistrationAdmission {
  state: RegistrationAdmissionState;
  reasons: string[];
  negotiatedProtocolVersion?: string;
  admittedAt: string;
}

/**
 * Horae's local supervision envelope. Its id is an admission record, not a
 * runtime identity, credential, or authority grant.
 */
export interface SupervisedRuntimeRegistration {
  id: string;
  registration: RuntimeRegistration;
  compatibility?: CompatibilityManifest;
  source: string;
  admission: RegistrationAdmission;
  lifecycle: RuntimeLifecycle;
  observation: RuntimeObservation;
  warnings: string[];
  registeredAt: string;
}

export interface PeerInspection {
  identity: RuntimeIdentity;
  health: RuntimeHealth;
  readiness: RuntimeReadiness;
  registration: RuntimeRegistration;
  compatibility: CompatibilityManifest;
  inspectionMechanism: string;
}

export type CapabilityExposureMode = "fixed" | "progressive";

export interface HoraeProfile {
  id: string;
  displayName: string;
  projectId: string;
  /** Capability ids/categories that are required for this profile. */
  requiredRuntimeCapabilities: string[];
  /** Capability ids/categories that may be reduced away without rejection. */
  optionalRuntimeCapabilities?: string[];
  /** Explicit allow-list; when absent, the required/optional lists are the allow-list. */
  allowedRuntimeCapabilities?: string[];
  defaultGateway?: string;
  /** Descriptive references only; neither value grants authority. */
  anankePolicyProfile?: string;
  mnemosyneMemoryScope?: string;
  auditDestinations: string[];
  capabilityExposure: CapabilityExposureMode;
}

/** Trusted-host request envelope. Task text is opaque and never supplies identity or scope. */
export interface HoraeSessionRequest {
  projectId: string;
  profileId: string;
  task: string;
  purpose: string;
  execution: AgentExecutionContext;
  scope: ResourceScope;
  correlation: CorrelationContext;
  requestedCapabilities?: string[];
  requiredCapabilities?: string[];
  optionalCapabilities?: string[];
  workflowId?: string;
  actionId?: string;
}

export type HiddenCapabilityReason =
  | "unhealthy"
  | "not_ready"
  | "stale"
  | "not_requested"
  | "profile_disallowed"
  | "incompatible_protocol"
  | "feature_missing"
  | "dependency_unavailable"
  | "provider_conflict"
  | "unadmitted"
  | "optional_unavailable";

export interface SelectedCapability extends Capability {
  runtimeId: string;
}

export interface HiddenCapability {
  capability: SelectedCapability;
  reason: HiddenCapabilityReason;
}

export interface HoraeCapabilityPlan {
  visible: SelectedCapability[];
  hidden: HiddenCapability[];
  requiredRuntimeIds: string[];
  optionalRuntimeIds: string[];
}

export interface CapabilityRequirementResult {
  capability: string;
  required: boolean;
  available: boolean;
  reason?: HiddenCapabilityReason;
}

export interface HoraeComposition {
  id: string;
  runtimeIds: string[];
  capabilityIds: string[];
  negotiatedProtocols: Record<string, string>;
  required: CapabilityRequirementResult[];
  optional: CapabilityRequirementResult[];
  correlation: CorrelationContext;
  createdAt: string;
  constraints: string[];
}

export type HoraeSessionState = "ready" | "degraded" | "not_ready" | "blocked" | "terminated";

export interface HoraeSessionStateAssessment {
  sessionId: string;
  compositionId: string;
  state: HoraeSessionState;
  checkedAt: string;
  degradedRuntimeIds: string[];
  reasons: string[];
}

export interface HoraeSession {
  id: string;
  composition: HoraeComposition;
  request: HoraeSessionRequest;
  profile: HoraeProfile;
  capabilityPlan: HoraeCapabilityPlan;
  runtimeIds: string[];
  startedAt: string;
}

/** Payloads are sanitized at the Horae audit boundary; correlation is metadata only. */
export interface HoraeEvent {
  id: string;
  type: string;
  occurredAt: string;
  correlation: CorrelationContext;
  sessionId?: string;
  runtimeId?: string;
  payload?: Record<string, unknown>;
}
