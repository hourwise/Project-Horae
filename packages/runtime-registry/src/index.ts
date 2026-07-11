import type {
  RuntimeCapability,
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
}
