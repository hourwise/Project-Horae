import type {
  RuntimeCapability,
  RuntimeHealth,
  RuntimeHealthAssessment,
  RuntimeHeartbeat,
  RuntimeLifecycle,
  RuntimeLifecycleState,
  RuntimeRegistration,
} from "@horae/schema";

const ALLOWED_LIFECYCLE_TRANSITIONS: Record<RuntimeLifecycleState, readonly RuntimeLifecycleState[]> = {
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

export class RuntimeLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeLifecycleError";
  }
}

export class RuntimeRegistry {
  private readonly registrations = new Map<string, RuntimeRegistration>();

  register(registration: RuntimeRegistration): void {
    if (this.registrations.has(registration.id)) {
      throw new RuntimeLifecycleError(`Runtime '${registration.id}' is already registered`);
    }

    this.registrations.set(registration.id, {
      ...registration,
      lifecycle: registration.lifecycle ?? {
        state: "registered",
        changedAt: registration.health.checkedAt,
      },
    });
  }

  list(): RuntimeRegistration[] {
    return [...this.registrations.values()];
  }

  get(id: string): RuntimeRegistration | undefined {
    return this.registrations.get(id);
  }

  transitionLifecycle(
    id: string,
    nextState: RuntimeLifecycleState,
    options: LifecycleTransitionOptions = {},
  ): RuntimeLifecycle {
    const registration = this.requireRegistration(id);
    const current = registration.lifecycle!;

    if (!ALLOWED_LIFECYCLE_TRANSITIONS[current.state].includes(nextState)) {
      throw new RuntimeLifecycleError(
        `Runtime '${id}' cannot transition from '${current.state}' to '${nextState}'`,
      );
    }

    const taskId = this.resolveTaskId(id, current, nextState, options.taskId);
    const changedAt = options.at ?? new Date().toISOString();
    const lifecycle: RuntimeLifecycle = {
      state: nextState,
      changedAt,
      ...(taskId ? { taskId } : {}),
      ...(nextState === "cancelling" ? { cancellationRequestedAt: changedAt } : {}),
      ...(options.message ? { message: options.message } : {}),
    };

    registration.lifecycle = lifecycle;
    return lifecycle;
  }

  recordHeartbeat(id: string, heartbeat: RuntimeHeartbeat): RuntimeHealth {
    const registration = this.requireRegistration(id);
    const checkedAt = this.requireTimestamp(heartbeat.checkedAt, "heartbeat checkedAt");
    const previousCheckedAt = this.requireTimestamp(
      registration.health.checkedAt,
      "registered health checkedAt",
    );

    if (checkedAt < previousCheckedAt) {
      throw new RuntimeLifecycleError(
        `Runtime '${id}' received an out-of-order heartbeat from '${heartbeat.checkedAt}'`,
      );
    }

    registration.health = {
      status: heartbeat.status,
      checkedAt: heartbeat.checkedAt,
      ...(heartbeat.message ? { message: heartbeat.message } : {}),
    };

    if (heartbeat.status === "degraded" || heartbeat.status === "unavailable") {
      this.degradeActiveRuntime(registration, heartbeat.checkedAt, heartbeat.message);
    }

    return registration.health;
  }

  assessHealth(maxAgeMs: number, now = new Date().toISOString()): RuntimeHealthAssessment[] {
    this.requireMaxAge(maxAgeMs);
    const nowMs = this.requireTimestamp(now, "health assessment time");

    return this.list().map((registration) => {
      const checkedAtMs = this.requireTimestamp(
        registration.health.checkedAt,
        `runtime '${registration.id}' health checkedAt`,
      );
      const ageMs = Math.max(0, nowMs - checkedAtMs);

      return {
        runtimeId: registration.id,
        health: registration.health,
        isStale: ageMs > maxAgeMs,
        ageMs,
      };
    });
  }

  markStaleRuntimes(options: StaleHeartbeatOptions): RuntimeHealthAssessment[] {
    this.requireMaxAge(options.maxAgeMs);

    const now = options.now ?? new Date().toISOString();
    const nowMs = this.requireTimestamp(now, "stale-heartbeat sweep time");
    const assessments: RuntimeHealthAssessment[] = [];

    for (const registration of this.list()) {
      const checkedAtMs = this.requireTimestamp(
        registration.health.checkedAt,
        `runtime '${registration.id}' health checkedAt`,
      );
      const ageMs = Math.max(0, nowMs - checkedAtMs);
      const isStale = ageMs > options.maxAgeMs;

      if (isStale && registration.health.status !== "unavailable") {
        const message = `Heartbeat exceeded the ${options.maxAgeMs}ms freshness limit`;
        registration.health = {
          status: "degraded",
          checkedAt: registration.health.checkedAt,
          message,
        };
        this.degradeActiveRuntime(registration, now, message);
      }

      assessments.push({
        runtimeId: registration.id,
        health: registration.health,
        isStale,
        ageMs,
      });
    }

    return assessments;
  }

  deregister(id: string): RuntimeRegistration {
    const registration = this.requireRegistration(id);
    const state = registration.lifecycle!.state;
    if (state !== "registered" && state !== "terminated" && state !== "failed") {
      throw new RuntimeLifecycleError(
        `Runtime '${id}' must be registered, terminated, or failed before deregistration`,
      );
    }

    this.registrations.delete(id);
    return registration;
  }

  listHealthyCapabilities(): RuntimeCapability[] {
    return this.list()
      .filter((registration) => registration.health.status === "healthy")
      .flatMap((registration) => registration.capabilities);
  }

  private requireRegistration(id: string): RuntimeRegistration {
    const registration = this.registrations.get(id);
    if (!registration) {
      throw new RuntimeLifecycleError(`Runtime '${id}' is not registered`);
    }
    return registration;
  }

  private resolveTaskId(
    id: string,
    current: RuntimeLifecycle,
    nextState: RuntimeLifecycleState,
    requestedTaskId?: string,
  ): string | undefined {
    if (nextState === "busy") {
      const taskId = requestedTaskId ?? current.taskId;
      if (!taskId) {
        throw new RuntimeLifecycleError(`Runtime '${id}' cannot become busy without a task owner`);
      }
      if (current.taskId && requestedTaskId && current.taskId !== requestedTaskId) {
        throw new RuntimeLifecycleError(
          `Runtime '${id}' is owned by task '${current.taskId}', not '${requestedTaskId}'`,
        );
      }
      return taskId;
    }

    if (
      nextState === "waiting" ||
      nextState === "degraded" ||
      nextState === "cancelling" ||
      nextState === "failed"
    ) {
      return current.taskId;
    }

    return undefined;
  }

  private degradeActiveRuntime(
    registration: RuntimeRegistration,
    at: string,
    message?: string,
  ): void {
    const state = registration.lifecycle!.state;
    if (state === "ready" || state === "busy" || state === "waiting") {
      this.transitionLifecycle(registration.id, "degraded", { at, message });
    }
  }

  private requireTimestamp(value: string, label: string): number {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      throw new RuntimeLifecycleError(`${label} must be an ISO-8601 timestamp`);
    }
    return timestamp;
  }

  private requireMaxAge(maxAgeMs: number): void {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
      throw new RuntimeLifecycleError("maxAgeMs must be a non-negative finite number");
    }
  }
}
