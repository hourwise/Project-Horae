import { randomUUID } from "node:crypto";
import { assertContextConsistency, parseCorrelation, parseExecutionContext, parseResourceScope, PrincipalKind, ResourceScopeMode } from "@horae/adrasteia-adapter";
import { assertNoCapabilityProviderConflicts, matchesAny, planCapabilities } from "@horae/capability-planner";
import { RuntimeRegistry } from "@horae/runtime-registry";
import type {
  HoraeProfile,
  HoraeSession,
  HoraeSessionRequest,
  HoraeSessionStateAssessment,
  SelectedCapability,
} from "@horae/schema";

export { CapabilityProviderConflictError } from "@horae/capability-planner";
export type { CapabilityProviderConflict } from "@horae/capability-planner";

export const DEFAULT_HORAE_PROTOCOL_VERSION = "1.4.0";

export class SessionRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionRequestValidationError";
  }
}

export class CompositionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositionValidationError";
  }
}

export interface SessionOrchestratorOptions {
  staleAfterMs?: number;
}

/** Validate trusted host context before any composition selection. */
export function validateTrustedSessionRequest(request: HoraeSessionRequest, profile: HoraeProfile): HoraeSessionRequest {
  if (!request.purpose.trim()) throw new SessionRequestValidationError("Horae session request requires purpose");
  if (request.projectId !== profile.projectId) throw new SessionRequestValidationError("request.projectId must equal profile.projectId");
  try {
    const execution = parseExecutionContext(request.execution);
    const scope = parseResourceScope(request.scope);
    const correlation = parseCorrelation(request.correlation);
    if (!correlation.requestId || !correlation.correlationId) throw new Error("request and correlation identifiers are required");
    assertContextConsistency(execution, scope, request.projectId);
    const allowed = new Set(profile.allowedRuntimeCapabilities ?? [
      ...profile.requiredRuntimeCapabilities,
      ...(profile.optionalRuntimeCapabilities ?? []),
    ]);
    for (const capability of [
      ...(request.requestedCapabilities ?? []),
      ...(request.requiredCapabilities ?? []),
      ...(request.optionalCapabilities ?? []),
    ]) {
      if (!allowed.has(capability)) throw new Error(`requested capability '${capability}' is not permitted by the profile`);
    }
    return { ...request, execution, scope, correlation };
  } catch (error) {
    throw new SessionRequestValidationError(error instanceof Error ? error.message : String(error));
  }
}

/** Explicit development-only helper with distinct local service and agent principals. */
export function createDevelopmentSessionRequest(input: {
  projectId: string;
  profileId: string;
  task: string;
  purpose: string;
  requestedCapabilities?: string[];
}): HoraeSessionRequest {
  const requestId = `req_${randomUUID()}`;
  return {
    ...input,
    execution: {
      authenticatedPrincipal: { id: "horae-development-host", kind: PrincipalKind.Service },
      actingPrincipal: { id: "horae-development-agent", kind: PrincipalKind.Agent },
      projectId: input.projectId,
      runtimeId: "horae-development",
      sessionId: `development_${randomUUID()}`,
    },
    scope: { mode: ResourceScopeMode.Bounded, projectId: input.projectId, resourceIds: [input.projectId] },
    correlation: { requestId, correlationId: `cor_${randomUUID()}` },
  };
}

export class SessionOrchestrator {
  private readonly staleAfterMs: number;

  constructor(
    private readonly registry: RuntimeRegistry,
    options: SessionOrchestratorOptions = {},
  ) {
    this.staleAfterMs = options.staleAfterMs ?? 60_000;
  }

  /** Composition is validation-only: it does not execute, retrieve, or mint authority. */
  start(request: HoraeSessionRequest, profile: HoraeProfile): HoraeSession {
    const trustedRequest = validateTrustedSessionRequest(request, profile);
    const capabilityPlan = planCapabilities(trustedRequest, profile, this.registry.list());
    assertNoCapabilityProviderConflicts(capabilityPlan.visible);
    const required = trustedRequest.requiredCapabilities ?? profile.requiredRuntimeCapabilities;
    const optional = trustedRequest.optionalCapabilities ?? profile.optionalRuntimeCapabilities ?? [];
    const missingRequired = required.filter((requirement) => !capabilityPlan.visible.some((capability) => matchesAny(capability, new Set([requirement]))));
    if (missingRequired.length) {
      throw new CompositionValidationError(`Required capabilities unavailable: ${missingRequired.join(", ")}`);
    }
    const selected = capabilityPlan.visible.filter((capability) => isRequested(capability, trustedRequest, profile));
    const runtimeIds = [...new Set(selected.map(({ runtimeId }) => runtimeId))].sort();
    const protocols = this.registry.assertProtocolCompatibility(runtimeIds);
    const startedAt = new Date().toISOString();
    const sessionId = `session_${randomUUID()}`;
    const compositionId = `composition_${randomUUID()}`;
    const correlation = { ...trustedRequest.correlation, sessionId };
    return {
      id: sessionId,
      composition: {
        id: compositionId,
        runtimeIds,
        capabilityIds: selected.map(({ id }) => id),
        negotiatedProtocols: protocols.negotiatedVersions,
        required: required.map((capability) => ({ capability, required: true, available: !missingRequired.includes(capability) })),
        optional: optional.map((capability) => ({
          capability,
          required: false,
          available: selected.some((selectedCapability) => matchesAny(selectedCapability, new Set([capability]))),
          ...(selected.some((selectedCapability) => matchesAny(selectedCapability, new Set([capability]))) ? {} : { reason: "optional_unavailable" as const }),
        })),
        correlation,
        createdAt: startedAt,
        constraints: [
          "Composition is inspection and planning only; no action execution or memory retrieval occurs.",
          "Correlation and portable references are metadata, not authority.",
        ],
      },
      request: trustedRequest,
      profile,
      capabilityPlan: { ...capabilityPlan, visible: selected },
      runtimeIds,
      startedAt,
    };
  }

  assessState(session: HoraeSession, checkedAt = new Date().toISOString()): HoraeSessionStateAssessment {
    const freshness = new Map(this.registry.assessHealth(this.staleAfterMs, checkedAt).map((assessment) => [assessment.runtimeId, assessment]));
    const degradedRuntimeIds: string[] = [];
    const reasons: string[] = [];
    let state: HoraeSessionStateAssessment["state"] = "ready";
    for (const runtimeId of session.composition.runtimeIds) {
      const registration = this.registry.get(runtimeId);
      if (!registration) {
        degradedRuntimeIds.push(runtimeId);
        reasons.push(`required peer '${runtimeId}' is missing`);
        state = "blocked";
        continue;
      }
      if (["terminated", "failed"].includes(registration.lifecycle.state)) {
        degradedRuntimeIds.push(runtimeId);
        reasons.push(`runtime '${runtimeId}' lifecycle is ${registration.lifecycle.state}`);
        state = "terminated";
        continue;
      }
      const assessment = freshness.get(runtimeId);
      if (assessment?.isStale || registration.observation.freshness !== "fresh") {
        degradedRuntimeIds.push(runtimeId);
        reasons.push(`runtime '${runtimeId}' observation is stale`);
        if (state === "ready") state = "degraded";
        continue;
      }
      if (registration.admission.state !== "admitted" || !registration.registration.readiness?.ready) {
        degradedRuntimeIds.push(runtimeId);
        reasons.push(`runtime '${runtimeId}' is not ready for composition`);
        if (state === "ready") state = "not_ready";
        continue;
      }
      if (!registration.registration.health?.healthy || ["degraded", "cancelling"].includes(registration.lifecycle.state)) {
        degradedRuntimeIds.push(runtimeId);
        reasons.push(`runtime '${runtimeId}' is degraded`);
        if (state === "ready") state = "degraded";
      }
    }
    return { sessionId: session.id, compositionId: session.composition.id, state, checkedAt, degradedRuntimeIds, reasons };
  }
}

function isRequested(capability: SelectedCapability, request: HoraeSessionRequest, profile: HoraeProfile): boolean {
  const requested = new Set(request.requestedCapabilities ?? [
    ...profile.requiredRuntimeCapabilities,
    ...(profile.optionalRuntimeCapabilities ?? []),
  ]);
  return matchesAny(capability, requested);
}
