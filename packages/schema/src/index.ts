export type RuntimeKind = "ananke" | "mnemosyne" | "horae" | "gateway" | "mcp-server" | "external";

export type RuntimeHealthStatus =
  | "healthy"
  | "busy"
  | "read_only"
  | "updating"
  | "degraded"
  | "unavailable";

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

export type CapabilityCategory =
  | "approval"
  | "policy"
  | "audit"
  | "memory"
  | "search"
  | "gateway"
  | "tool"
  | "context"
  | "runtime";

export interface RuntimeIdentity {
  runtime: RuntimeKind | string;
  version: string;
  protocolVersion: string;
  displayName?: string;
}

export interface RuntimeHealth {
  status: RuntimeHealthStatus;
  checkedAt: string;
  message?: string;
}

export interface RuntimeCapability {
  id: string;
  runtimeId: string;
  category: CapabilityCategory;
  name: string;
  description?: string;
  riskClass?: string;
  requiresGovernance?: boolean;
  requiresMemory?: boolean;
  tags?: string[];
}

export interface RuntimeRegistration {
  id: string;
  identity: RuntimeIdentity;
  health: RuntimeHealth;
  lifecycle?: RuntimeLifecycle;
  capabilities: RuntimeCapability[];
  endpoint?: string;
  tags?: string[];
}

export type CapabilityExposureMode = "fixed" | "progressive";

export interface HoraeProfile {
  id: string;
  displayName: string;
  projectId: string;
  requiredRuntimeCapabilities: string[];
  defaultGateway?: string;
  anankePolicyProfile?: string;
  mnemosyneMemoryScope?: string;
  auditDestinations: string[];
  capabilityExposure: CapabilityExposureMode;
}

export interface HoraeSessionRequest {
  projectId: string;
  profileId: string;
  task: string;
  requestedCapabilities?: string[];
}

export interface HiddenCapability {
  capability: RuntimeCapability;
  reason: "unhealthy_runtime" | "not_requested" | "profile_disallowed" | "incompatible" | "unknown";
}

export interface HoraeCapabilityPlan {
  visible: RuntimeCapability[];
  hidden: HiddenCapability[];
  requiredRuntimeIds: string[];
}

export interface HoraeSession {
  id: string;
  request: HoraeSessionRequest;
  profile: HoraeProfile;
  capabilityPlan: HoraeCapabilityPlan;
  runtimeIds: string[];
  startedAt: string;
}

export interface HoraeEvent {
  id: string;
  type: string;
  occurredAt: string;
  sessionId?: string;
  runtimeId?: string;
  payload?: Record<string, unknown>;
}
