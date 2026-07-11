import { describe, expect, it } from "vitest";
import { RuntimeLifecycleError, RuntimeRegistry } from "@horae/runtime-registry";
import type { RuntimeRegistration } from "@horae/schema";

function runtime(): RuntimeRegistration {
  return {
    id: "worker-local",
    identity: {
      runtime: "external",
      version: "0.1.0",
      protocolVersion: "0.1.0",
    },
    health: {
      status: "healthy",
      checkedAt: "2026-07-11T12:00:00.000Z",
    },
    capabilities: [],
  };
}

describe("runtime lifecycle", () => {
  it("initialises registrations and follows a task-owned lifecycle", () => {
    const registry = new RuntimeRegistry();
    registry.register(runtime());

    expect(registry.get("worker-local")?.lifecycle).toEqual({
      state: "registered",
      changedAt: "2026-07-11T12:00:00.000Z",
    });

    registry.transitionLifecycle("worker-local", "initialising", {
      at: "2026-07-11T12:01:00.000Z",
    });
    registry.transitionLifecycle("worker-local", "ready", {
      at: "2026-07-11T12:02:00.000Z",
    });
    registry.transitionLifecycle("worker-local", "busy", {
      taskId: "task-123",
      at: "2026-07-11T12:03:00.000Z",
    });
    registry.transitionLifecycle("worker-local", "waiting", {
      at: "2026-07-11T12:04:00.000Z",
    });
    registry.transitionLifecycle("worker-local", "busy", {
      at: "2026-07-11T12:05:00.000Z",
    });
    const cancelling = registry.transitionLifecycle("worker-local", "cancelling", {
      at: "2026-07-11T12:06:00.000Z",
      message: "Task cancelled by owner",
    });

    expect(cancelling).toEqual({
      state: "cancelling",
      changedAt: "2026-07-11T12:06:00.000Z",
      taskId: "task-123",
      cancellationRequestedAt: "2026-07-11T12:06:00.000Z",
      message: "Task cancelled by owner",
    });

    registry.transitionLifecycle("worker-local", "terminated", {
      at: "2026-07-11T12:07:00.000Z",
    });
    expect(registry.deregister("worker-local").lifecycle?.state).toBe("terminated");
    expect(registry.get("worker-local")).toBeUndefined();
  });

  it("rejects invalid transitions and busy workers without task ownership", () => {
    const registry = new RuntimeRegistry();
    registry.register(runtime());

    expect(() => registry.transitionLifecycle("worker-local", "busy")).toThrow(
      RuntimeLifecycleError,
    );

    registry.transitionLifecycle("worker-local", "initialising");
    registry.transitionLifecycle("worker-local", "ready");

    expect(() => registry.transitionLifecycle("worker-local", "busy")).toThrow(
      "cannot become busy without a task owner",
    );
    expect(() => registry.deregister("worker-local")).toThrow(
      "must be registered, terminated, or failed",
    );
  });

  it("supports explicit recovery from a failed runtime", () => {
    const registry = new RuntimeRegistry();
    registry.register(runtime());
    registry.transitionLifecycle("worker-local", "initialising");
    registry.transitionLifecycle("worker-local", "failed", { message: "Startup failed" });

    const recovery = registry.transitionLifecycle("worker-local", "initialising", {
      message: "Operator requested recovery",
    });

    expect(recovery.state).toBe("initialising");
    expect(recovery.taskId).toBeUndefined();
  });

  it("retains task ownership while a worker is degraded", () => {
    const registry = new RuntimeRegistry();
    registry.register(runtime());
    registry.transitionLifecycle("worker-local", "initialising");
    registry.transitionLifecycle("worker-local", "ready");
    registry.transitionLifecycle("worker-local", "busy", { taskId: "task-123" });

    const degraded = registry.transitionLifecycle("worker-local", "degraded", {
      message: "Heartbeat missed",
    });
    const cancelling = registry.transitionLifecycle("worker-local", "cancelling");

    expect(degraded.taskId).toBe("task-123");
    expect(cancelling.taskId).toBe("task-123");
  });

  it("rejects duplicate and unknown registrations", () => {
    const registry = new RuntimeRegistry();
    registry.register(runtime());

    expect(() => registry.register(runtime())).toThrow("already registered");
    expect(() => registry.transitionLifecycle("missing", "initialising")).toThrow(
      "is not registered",
    );
  });
});
