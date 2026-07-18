import type {
  HiddenCapabilityReason,
  HoraeCapabilityPlan,
  HoraeProfile,
  HoraeSessionRequest,
  SelectedCapability,
  SupervisedRuntimeRegistration,
} from "@horae/schema";

export interface CapabilityProviderConflict {
  capabilityId: string;
  runtimeIds: string[];
}

export class CapabilityProviderConflictError extends Error {
  constructor(readonly conflict: CapabilityProviderConflict) {
    super(`Capability '${conflict.capabilityId}' is provided by multiple selected runtimes: ${conflict.runtimeIds.join(", ")}`);
    this.name = "CapabilityProviderConflictError";
  }
}

export function findCapabilityProviderConflicts(capabilities: readonly SelectedCapability[]): CapabilityProviderConflict[] {
  const runtimeIdsByCapabilityId = new Map<string, Set<string>>();
  for (const capability of capabilities) {
    const ids = runtimeIdsByCapabilityId.get(capability.id) ?? new Set<string>();
    ids.add(capability.runtimeId);
    runtimeIdsByCapabilityId.set(capability.id, ids);
  }
  return [...runtimeIdsByCapabilityId]
    .map(([capabilityId, runtimeIds]) => ({ capabilityId, runtimeIds: [...runtimeIds].sort() }))
    .filter(({ runtimeIds }) => runtimeIds.length > 1)
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
}

export function assertNoCapabilityProviderConflicts(capabilities: readonly SelectedCapability[]): CapabilityProviderConflict[] {
  const conflicts = findCapabilityProviderConflicts(capabilities);
  if (conflicts[0]) throw new CapabilityProviderConflictError(conflicts[0]);
  return conflicts;
}

/**
 * Applies only reducing constraints. It never promotes discovery records into
 * active capabilities and a worsening peer condition cannot increase output.
 */
export function planCapabilities(
  request: HoraeSessionRequest,
  profile: HoraeProfile,
  registrations: readonly SupervisedRuntimeRegistration[],
): HoraeCapabilityPlan {
  const allowed = new Set(profile.allowedRuntimeCapabilities ?? [
    ...profile.requiredRuntimeCapabilities,
    ...(profile.optionalRuntimeCapabilities ?? []),
  ]);
  const requested = new Set(request.requestedCapabilities ?? [...allowed]);
  const required = new Set(request.requiredCapabilities ?? profile.requiredRuntimeCapabilities);
  const visible: SelectedCapability[] = [];
  const hidden: HoraeCapabilityPlan["hidden"] = [];

  for (const registration of registrations) {
    const capabilities = registration.registration.capabilities ?? registration.registration.identity.capabilities ?? [];
    for (const portable of capabilities) {
      const capability: SelectedCapability = { ...portable, runtimeId: registration.id };
      const reason = hiddenReason(capability, registration, allowed, requested);
      if (reason) hidden.push({ capability, reason });
      else visible.push(capability);
    }
  }

  const runtimeIds = (capabilities: readonly SelectedCapability[]) => [...new Set(capabilities.map(({ runtimeId }) => runtimeId))].sort();
  return {
    visible: visible.sort((left, right) => left.id.localeCompare(right.id) || left.runtimeId.localeCompare(right.runtimeId)),
    hidden: hidden.sort((left, right) => left.capability.id.localeCompare(right.capability.id) || left.capability.runtimeId.localeCompare(right.capability.runtimeId)),
    requiredRuntimeIds: runtimeIds(visible.filter((capability) => matchesAny(capability, required))),
    optionalRuntimeIds: runtimeIds(visible.filter((capability) => !matchesAny(capability, required))),
  };
}

export function matchesAny(capability: SelectedCapability, requested: ReadonlySet<string>): boolean {
  return requested.has(capability.id) || Boolean(capability.category && requested.has(capability.category));
}

function hiddenReason(
  capability: SelectedCapability,
  registration: SupervisedRuntimeRegistration,
  allowed: ReadonlySet<string>,
  requested: ReadonlySet<string>,
): HiddenCapabilityReason | undefined {
  if (registration.admission.state !== "admitted" && registration.admission.state !== "constrained") return "unadmitted";
  if (registration.observation.freshness !== "fresh") return "stale";
  if (!registration.registration.health?.healthy) return "unhealthy";
  if (!registration.registration.readiness?.ready) return "not_ready";
  if (capability.exposure !== "active") return "not_requested";
  if (capability.dependencyState && capability.dependencyState !== "available") return "dependency_unavailable";
  if (!matchesAny(capability, allowed)) return "profile_disallowed";
  if (!matchesAny(capability, requested)) return "not_requested";
  return undefined;
}
