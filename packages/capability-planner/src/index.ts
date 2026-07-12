import type {
  HoraeCapabilityPlan,
  HoraeProfile,
  HoraeSessionRequest,
  RuntimeCapability,
  RuntimeRegistration,
} from "@horae/schema";

export interface CapabilityProviderConflict {
  capabilityId: string;
  runtimeIds: string[];
}

export class CapabilityProviderConflictError extends Error {
  readonly capabilityId: string;
  readonly runtimeIds: string[];

  constructor(conflict: CapabilityProviderConflict) {
    super(
      `Capability '${conflict.capabilityId}' is provided by multiple selected runtimes: ${conflict.runtimeIds.join(", ")}`,
    );
    this.name = "CapabilityProviderConflictError";
    this.capabilityId = conflict.capabilityId;
    this.runtimeIds = conflict.runtimeIds;
  }
}

export function findCapabilityProviderConflicts(
  capabilities: readonly RuntimeCapability[],
): CapabilityProviderConflict[] {
  const runtimeIdsByCapabilityId = new Map<string, Set<string>>();

  for (const capability of capabilities) {
    const runtimeIds = runtimeIdsByCapabilityId.get(capability.id) ?? new Set<string>();
    runtimeIds.add(capability.runtimeId);
    runtimeIdsByCapabilityId.set(capability.id, runtimeIds);
  }

  return [...runtimeIdsByCapabilityId].flatMap(([capabilityId, runtimeIds]) =>
    runtimeIds.size > 1 ? [{ capabilityId, runtimeIds: [...runtimeIds] }] : [],
  );
}

export function assertNoCapabilityProviderConflicts(
  capabilities: readonly RuntimeCapability[],
): CapabilityProviderConflict[] {
  const conflicts = findCapabilityProviderConflicts(capabilities);
  const firstConflict = conflicts[0];

  if (firstConflict) {
    throw new CapabilityProviderConflictError(firstConflict);
  }

  return conflicts;
}

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
        reason:
          registration.health.status === "healthy"
            ? ("not_requested" as const)
            : ("unhealthy_runtime" as const),
      })),
  );

  return {
    visible,
    hidden,
    requiredRuntimeIds: [...new Set(visible.map((capability) => capability.runtimeId))],
  };
}
