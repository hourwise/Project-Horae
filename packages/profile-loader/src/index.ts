import type { HoraeProfile } from "@horae/schema";

export class HoraeProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoraeProfileValidationError";
  }
}

/** Validates Horae-owned profile selection rules, never policy authority. */
export function defineProfile(profile: HoraeProfile): HoraeProfile {
  if (!profile.id.trim() || !profile.projectId.trim()) {
    throw new HoraeProfileValidationError("Horae profile requires a stable id and projectId");
  }
  for (const value of [
    profile.id,
    profile.projectId,
    ...profile.requiredRuntimeCapabilities,
    ...(profile.optionalRuntimeCapabilities ?? []),
    ...(profile.allowedRuntimeCapabilities ?? []),
  ]) {
    if (!value.trim() || /[*!?\[\]]/.test(value)) {
      throw new HoraeProfileValidationError("Horae profile values must be bounded and wildcard-free");
    }
  }
  const allowed = new Set(profile.allowedRuntimeCapabilities ?? [
    ...profile.requiredRuntimeCapabilities,
    ...(profile.optionalRuntimeCapabilities ?? []),
  ]);
  if (profile.requiredRuntimeCapabilities.some((capability) => !allowed.has(capability))) {
    throw new HoraeProfileValidationError("Horae profile required capabilities must be allowed");
  }
  return { ...profile, allowedRuntimeCapabilities: [...allowed].sort() };
}
