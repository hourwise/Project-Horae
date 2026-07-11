import { planCapabilities } from "@horae/capability-planner";
import { RuntimeRegistry } from "@horae/runtime-registry";
import type { HoraeProfile, HoraeSession, HoraeSessionRequest } from "@horae/schema";

export class SessionOrchestrator {
  constructor(private readonly registry: RuntimeRegistry) {}

  start(request: HoraeSessionRequest, profile: HoraeProfile): HoraeSession {
    const capabilityPlan = planCapabilities(request, profile, this.registry.list());
    const startedAt = new Date().toISOString();

    return {
      id: `session_${Date.now()}`,
      request,
      profile,
      capabilityPlan,
      runtimeIds: capabilityPlan.requiredRuntimeIds,
      startedAt,
    };
  }
}
