import type {
  HoraeCapabilityPlan,
  HoraeProfile,
  HoraeSessionRequest,
  RuntimeRegistration,
} from "@horae/schema";

export function planCapabilities(
  request: HoraeSessionRequest,
  profile: HoraeProfile,
  registrations: RuntimeRegistration[],
): HoraeCapabilityPlan {
  const requested = new Set(request.requestedCapabilities ?? profile.requiredRuntimeCapabilities);
  const visible = registrations
    .filter((registration) => registration.health.status === "healthy")
    .flatMap((registration) => registration.capabilities)
    .filter((capability) => requested.has(capability.category) || requested.has(capability.id));

  const visibleIds = new Set(visible.map((capability) => capability.id));
  const hidden = registrations.flatMap((registration) =>
    registration.capabilities
      .filter((capability) => !visibleIds.has(capability.id))
      .map((capability) => ({
        capability,
        reason: registration.health.status === "healthy" ? "not_requested" as const : "unhealthy_runtime" as const,
      })),
  );

  return {
    visible,
    hidden,
    requiredRuntimeIds: [...new Set(visible.map((capability) => capability.runtimeId))],
  };
}
