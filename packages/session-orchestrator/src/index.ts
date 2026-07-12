import { assertNoCapabilityProviderConflicts, planCapabilities } from "@horae/capability-planner";
import { RuntimeRegistry } from "@horae/runtime-registry";
import type {
  HoraeProfile,
  HoraeSession,
  HoraeSessionRequest,
  HoraeSessionStateAssessment,
} from "@horae/schema";

export { CapabilityProviderConflictError } from "@horae/capability-planner";
export type { CapabilityProviderConflict } from "@horae/capability-planner";

export const DEFAULT_HORAE_PROTOCOL_VERSION = "0.1.0";

export interface SessionOrchestratorOptions {
  protocolVersion?: string;
}

export class SessionOrchestrator {
  private readonly protocolVersion: string;

  constructor(
    private readonly registry: RuntimeRegistry,
    options: SessionOrchestratorOptions = {},
  ) {
    this.protocolVersion = options.protocolVersion ?? DEFAULT_HORAE_PROTOCOL_VERSION;
  }

  start(request: HoraeSessionRequest, profile: HoraeProfile): HoraeSession {
    const capabilityPlan = planCapabilities(request, profile, this.registry.list());
    assertNoCapabilityProviderConflicts(capabilityPlan.visible);
    this.registry.assertProtocolCompatibility(
      this.protocolVersion,
      capabilityPlan.requiredRuntimeIds,
    );
    const startedAt = new Date().toISOString();
    const identifierTimestamp = Date.now();
    const runtimeIds = capabilityPlan.requiredRuntimeIds;

    return {
      id: `session_${identifierTimestamp}`,
      composition: {
        id: `composition_${identifierTimestamp}`,
        runtimeIds,
        capabilityIds: capabilityPlan.visible.map((capability) => capability.id),
        createdAt: startedAt,
      },
      request,
      profile,
      capabilityPlan,
      runtimeIds,
      startedAt,
    };
  }

  assessState(
    session: HoraeSession,
    checkedAt = new Date().toISOString(),
  ): HoraeSessionStateAssessment {
    const degradedRuntimeIds = session.composition.runtimeIds.filter((runtimeId) => {
      const registration = this.registry.get(runtimeId);
      return (
        !registration ||
        registration.health.status !== "healthy" ||
        registration.lifecycle?.state === "degraded" ||
        registration.lifecycle?.state === "cancelling" ||
        registration.lifecycle?.state === "terminated" ||
        registration.lifecycle?.state === "failed"
      );
    });

    return {
      sessionId: session.id,
      compositionId: session.composition.id,
      state: degradedRuntimeIds.length > 0 ? "degraded" : "ready",
      checkedAt,
      degradedRuntimeIds,
    };
  }
}
