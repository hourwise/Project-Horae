import {
  ADRASTEIA_BASELINE,
  negotiateWithHorae,
  parseCompatibilityManifest,
  parseRuntimeHealth,
  parseRuntimeRegistration,
} from "@horae/adrasteia-adapter";
import type {
  CompatibilityManifest,
  RegistrationAdmission,
  RuntimeHealth,
  RuntimeLifecycle,
  RuntimeLifecycleState,
  RuntimeObservation,
  RuntimeRegistration,
  SupervisedRuntimeRegistration,
} from "@horae/schema";

const ALLOWED_LIFECYCLE_TRANSITIONS: Record<
  RuntimeLifecycleState,
  readonly RuntimeLifecycleState[]
> = {
  registered: ["initialising", "terminated"],
  initialising: ["ready", "cancelling", "failed"],
  ready: ["busy", "degraded", "cancelling", "terminated", "failed"],
  busy: ["waiting", "ready", "degraded", "cancelling", "failed"],
  waiting: ["busy", "ready", "degraded", "cancelling", "failed"],
  degraded: ["ready", "cancelling", "terminated", "failed"],
  cancelling: ["terminated", "failed"],
  terminated: ["initialising"],
  failed: ["initialising", "terminated"],
};

export interface LifecycleTransitionOptions {
  at?: string;
  taskId?: string;
  message?: string;
}

export interface StaleHeartbeatOptions {
  maxAgeMs: number;
  now?: string;
}

export interface RuntimeHealthAssessment {
  runtimeId: string;
  health?: RuntimeHealth;
  isStale: boolean;
  ageMs: number;
  freshness: RuntimeObservation["freshness"];
}

export interface PeerRegistrationCandidate {
  /** Horae admission identifier; not a peer identity or credential. */
  id: string;
  registration: unknown;
  compatibility: unknown;
  source: string;
  observedAt?: string;
}

export interface ProtocolNegotiationResult {
  checkedRuntimeIds: string[];
  compatibleRuntimeIds: string[];
  incompatibleRuntimeIds: string[];
  negotiatedVersions: Record<string, string>;
  reasons: Record<string, string>;
}

export class RuntimeLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeLifecycleError";
  }
}

export class RegistrationAdmissionError extends RuntimeLifecycleError {
  constructor(readonly admission: RegistrationAdmission) {
    super(`Runtime registration was ${admission.state}: ${admission.reasons.join(", ")}`);
    this.name = "RegistrationAdmissionError";
  }
}

export class RuntimeProtocolCompatibilityError extends RuntimeLifecycleError {
  constructor(
    readonly runtimeId: string,
    readonly reason: string,
  ) {
    super(`Runtime '${runtimeId}' is protocol-incompatible: ${reason}`);
    this.name = "RuntimeProtocolCompatibilityError";
  }
}

/**
 * Horae's registry owns only admission and local supervision. Canonical peer
 * snapshots stay peer-reported and stale observation never rewrites them.
 */
export class RuntimeRegistry {
  private readonly registrations = new Map<string, SupervisedRuntimeRegistration>();
  private readonly instanceIds = new Map<string, string>();

  register(candidate: PeerRegistrationCandidate): SupervisedRuntimeRegistration {
    const admitted = this.admit(candidate);
    if (admitted.admission.state !== "admitted" && admitted.admission.state !== "constrained") {
      throw new RegistrationAdmissionError(admitted.admission);
    }
    if (this.registrations.has(candidate.id)) {
      throw new RuntimeLifecycleError(`Runtime '${candidate.id}' is already registered`);
    }
    const instanceId = admitted.registration.identity.instanceId;
    if (instanceId && this.instanceIds.has(instanceId)) {
      throw new RegistrationAdmissionError({
        state: "duplicate",
        reasons: [`runtime instance '${instanceId}' is already supervised`],
        admittedAt: admitted.admission.admittedAt,
      });
    }
    this.registrations.set(candidate.id, admitted);
    if (instanceId) this.instanceIds.set(instanceId, candidate.id);
    return admitted;
  }

  /** Parse and assess a peer without admitting it to local supervision. */
  admit(candidate: PeerRegistrationCandidate): SupervisedRuntimeRegistration {
    const admittedAt = candidate.observedAt ?? new Date().toISOString();
    this.requireTimestamp(admittedAt, "registration observation time");
    const fallback = this.unadmitted(candidate, admittedAt, "malformed", ["candidate could not be parsed"]);
    if (!candidate.id.trim() || !candidate.source.trim()) {
      return this.unadmitted(candidate, admittedAt, "unverified_source", ["binding source is required"]);
    }
    if (candidate.source === "unverified") {
      return this.unadmitted(candidate, admittedAt, "unverified_source", ["binding source is unverified"]);
    }
    try {
      const registration = parseRuntimeRegistration(candidate.registration);
      const compatibility = parseCompatibilityManifest(candidate.compatibility);
      const reasons: string[] = [];
      const identity = registration.identity;
      if (compatibility.runtimeName !== identity.runtime) reasons.push("compatibility runtime name differs from identity");
      if (compatibility.protocolVersion !== identity.protocolVersion) reasons.push("compatibility protocol version differs from identity");
      if (!registration.endpoints?.length) reasons.push("registration declares no endpoints");
      if (!registration.readiness) reasons.push("registration has no readiness evidence");
      if (!registration.health) reasons.push("registration has no health evidence");
      const negotiation = negotiateWithHorae(
        identity.protocolVersion,
        identity.minimumProtocolVersion ?? identity.protocolVersion,
      );
      if (!negotiation.compatible) {
        return this.createSupervised(candidate, registration, compatibility, admittedAt, {
          state: "incompatible",
          reasons: [negotiation.reason ?? "protocol negotiation failed"],
          admittedAt,
        });
      }
      if (reasons.length) {
        return this.createSupervised(candidate, registration, compatibility, admittedAt, {
          state: "identity_mismatch",
          reasons,
          admittedAt,
        });
      }
      const readiness = registration.readiness;
      if (!readiness?.ready) {
        return this.createSupervised(candidate, registration, compatibility, admittedAt, {
          state: "not_ready",
          reasons: ["peer has not declared readiness"],
          negotiatedProtocolVersion: negotiation.negotiatedVersion,
          admittedAt,
        });
      }
      const constrained = registration.health && !registration.health.healthy;
      return this.createSupervised(candidate, registration, compatibility, admittedAt, {
        state: constrained ? "constrained" : "admitted",
        reasons: constrained ? ["peer health is not healthy"] : [],
        negotiatedProtocolVersion: negotiation.negotiatedVersion,
        admittedAt,
      });
    } catch (error) {
      return {
        ...fallback,
        admission: {
          state: "malformed",
          reasons: [error instanceof Error ? error.message : String(error)],
          admittedAt,
        },
      };
    }
  }

  list(): SupervisedRuntimeRegistration[] {
    return [...this.registrations.values()];
  }

  get(id: string): SupervisedRuntimeRegistration | undefined {
    return this.registrations.get(id);
  }

  negotiateProtocol(runtimeIds: readonly string[] = this.list().map(({ id }) => id)): ProtocolNegotiationResult {
    const checkedRuntimeIds = [...new Set(runtimeIds)];
    const compatibleRuntimeIds: string[] = [];
    const incompatibleRuntimeIds: string[] = [];
    const negotiatedVersions: Record<string, string> = {};
    const reasons: Record<string, string> = {};
    for (const id of checkedRuntimeIds) {
      const runtime = this.requireRegistration(id);
      const identity = runtime.registration.identity;
      const result = negotiateWithHorae(
        identity.protocolVersion,
        identity.minimumProtocolVersion ?? identity.protocolVersion,
      );
      if (result.compatible && result.negotiatedVersion) {
        compatibleRuntimeIds.push(id);
        negotiatedVersions[id] = result.negotiatedVersion;
      } else {
        incompatibleRuntimeIds.push(id);
        reasons[id] = result.reason ?? "no_overlap";
      }
    }
    return { checkedRuntimeIds, compatibleRuntimeIds, incompatibleRuntimeIds, negotiatedVersions, reasons };
  }

  assertProtocolCompatibility(runtimeIds?: readonly string[]): ProtocolNegotiationResult {
    const result = this.negotiateProtocol(runtimeIds);
    const first = result.incompatibleRuntimeIds[0];
    if (first) throw new RuntimeProtocolCompatibilityError(first, result.reasons[first] ?? "no_overlap");
    return result;
  }

  transitionLifecycle(
    id: string,
    nextState: RuntimeLifecycleState,
    options: LifecycleTransitionOptions = {},
  ): RuntimeLifecycle {
    const registration = this.requireRegistration(id);
    const current = registration.lifecycle;
    if (!ALLOWED_LIFECYCLE_TRANSITIONS[current.state].includes(nextState)) {
      throw new RuntimeLifecycleError(`Runtime '${id}' cannot transition from '${current.state}' to '${nextState}'`);
    }
    const taskId = this.resolveTaskId(id, current, nextState, options.taskId);
    const changedAt = options.at ?? new Date().toISOString();
    registration.lifecycle = {
      state: nextState,
      changedAt,
      ...(taskId ? { taskId } : {}),
      ...(nextState === "cancelling" ? { cancellationRequestedAt: changedAt } : {}),
      ...(options.message ? { message: options.message } : {}),
    };
    return registration.lifecycle;
  }

  /** A newer peer snapshot can degrade local lifecycle but never recover it implicitly. */
  recordHeartbeat(id: string, heartbeat: unknown): RuntimeHealth {
    const registration = this.requireRegistration(id);
    const health = parseRuntimeHealth(heartbeat);
    const checkedAt = this.requireTimestamp(health.checkedAt ?? new Date().toISOString(), "heartbeat checkedAt");
    const previous = registration.observation.sourceCheckedAt;
    if (previous && checkedAt < this.requireTimestamp(previous, "previous heartbeat checkedAt")) {
      throw new RuntimeLifecycleError(`Runtime '${id}' received an out-of-order heartbeat`);
    }
    registration.registration = { ...registration.registration, health };
    registration.observation = {
      observedAt: new Date().toISOString(),
      sourceCheckedAt: health.checkedAt,
      freshness: "fresh",
      ageMs: 0,
      bindingAvailable: true,
    };
    if (!health.healthy) this.degradeActiveRuntime(registration, registration.observation.observedAt, "Peer reported degraded health");
    return health;
  }

  assessHealth(maxAgeMs: number, now = new Date().toISOString()): RuntimeHealthAssessment[] {
    this.requireMaxAge(maxAgeMs);
    const nowMs = this.requireTimestamp(now, "health assessment time");
    return this.list().map((registration) => this.assessRegistration(registration, nowMs, maxAgeMs));
  }

  /** Marks freshness and local lifecycle only; peer health snapshot is preserved. */
  markStaleRuntimes(options: StaleHeartbeatOptions): RuntimeHealthAssessment[] {
    this.requireMaxAge(options.maxAgeMs);
    const now = options.now ?? new Date().toISOString();
    const nowMs = this.requireTimestamp(now, "stale-heartbeat sweep time");
    return this.list().map((registration) => {
      const assessment = this.assessRegistration(registration, nowMs, options.maxAgeMs);
      registration.observation = {
        ...registration.observation,
        observedAt: now,
        freshness: assessment.freshness,
        ageMs: assessment.ageMs,
      };
      if (assessment.isStale) this.degradeActiveRuntime(registration, now, `Observation exceeded ${options.maxAgeMs}ms freshness limit`);
      return assessment;
    });
  }

  deregister(id: string): SupervisedRuntimeRegistration {
    const registration = this.requireRegistration(id);
    if (!["registered", "terminated", "failed"].includes(registration.lifecycle.state)) {
      throw new RuntimeLifecycleError(`Runtime '${id}' must be registered, terminated, or failed before deregistration`);
    }
    this.registrations.delete(id);
    const instanceId = registration.registration.identity.instanceId;
    if (instanceId) this.instanceIds.delete(instanceId);
    return registration;
  }

  private createSupervised(
    candidate: PeerRegistrationCandidate,
    registration: RuntimeRegistration,
    compatibility: CompatibilityManifest,
    observedAt: string,
    admission: RegistrationAdmission,
  ): SupervisedRuntimeRegistration {
    const health = registration.health;
    const sourceCheckedAt = health?.checkedAt;
    return {
      id: candidate.id,
      registration,
      compatibility,
      source: candidate.source,
      admission,
      lifecycle: { state: "registered", changedAt: observedAt },
      observation: { observedAt, sourceCheckedAt, freshness: "fresh", ageMs: 0, bindingAvailable: true },
      warnings: admission.reasons,
      registeredAt: observedAt,
    };
  }

  private unadmitted(
    candidate: PeerRegistrationCandidate,
    observedAt: string,
    state: RegistrationAdmission["state"],
    reasons: string[],
  ): SupervisedRuntimeRegistration {
    const registration = {
      identity: { runtime: "unknown", version: "0.0.0", protocolVersion: ADRASTEIA_BASELINE.protocolVersion },
      capabilities: [],
      endpoints: [],
    } as unknown as RuntimeRegistration;
    const compatibility = {
      manifestSchemaVersion: "1.0.0",
      runtimeName: "unknown",
      runtimeVersion: "0.0.0",
      packageVersion: "unknown",
      protocolVersion: ADRASTEIA_BASELINE.protocolVersion,
      minimumSupportedProtocolVersion: ADRASTEIA_BASELINE.minimumProtocolVersion,
      supportedProtocolRange: { minimum: ADRASTEIA_BASELINE.minimumProtocolVersion, maximum: ADRASTEIA_BASELINE.protocolVersion },
    } as unknown as CompatibilityManifest;
    return this.createSupervised(candidate, registration, compatibility, observedAt, { state, reasons, admittedAt: observedAt });
  }

  private assessRegistration(
    registration: SupervisedRuntimeRegistration,
    nowMs: number,
    maxAgeMs: number,
  ): RuntimeHealthAssessment {
    const checkedAt = registration.observation.sourceCheckedAt ?? registration.observation.observedAt;
    const ageMs = Math.max(0, nowMs - this.requireTimestamp(checkedAt, `runtime '${registration.id}' observation time`));
    const isStale = ageMs > maxAgeMs;
    return {
      runtimeId: registration.id,
      health: registration.registration.health,
      isStale,
      ageMs,
      freshness: isStale ? "stale" : registration.observation.bindingAvailable ? "fresh" : "unavailable",
    };
  }

  private requireRegistration(id: string): SupervisedRuntimeRegistration {
    const registration = this.registrations.get(id);
    if (!registration) throw new RuntimeLifecycleError(`Runtime '${id}' is not registered`);
    return registration;
  }

  private resolveTaskId(id: string, current: RuntimeLifecycle, nextState: RuntimeLifecycleState, requestedTaskId?: string): string | undefined {
    if (nextState === "busy") {
      const taskId = requestedTaskId ?? current.taskId;
      if (!taskId) throw new RuntimeLifecycleError(`Runtime '${id}' cannot become busy without a task owner`);
      if (current.taskId && requestedTaskId && current.taskId !== requestedTaskId) {
        throw new RuntimeLifecycleError(`Runtime '${id}' is owned by task '${current.taskId}', not '${requestedTaskId}'`);
      }
      return taskId;
    }
    if (["waiting", "degraded", "cancelling", "failed"].includes(nextState)) return current.taskId;
    return undefined;
  }

  private degradeActiveRuntime(registration: SupervisedRuntimeRegistration, at: string, message?: string): void {
    if (["ready", "busy", "waiting"].includes(registration.lifecycle.state)) {
      this.transitionLifecycle(registration.id, "degraded", { at, message });
    }
  }

  private requireTimestamp(value: string, label: string): number {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) throw new RuntimeLifecycleError(`${label} must be an ISO-8601 timestamp`);
    return timestamp;
  }

  private requireMaxAge(maxAgeMs: number): void {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw new RuntimeLifecycleError("maxAgeMs must be a non-negative finite number");
  }
}
