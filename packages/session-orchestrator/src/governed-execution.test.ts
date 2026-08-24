import { describe, expect, it, vi } from "vitest";
import type { HoraeSession } from "@horae/schema";
import { PrincipalKind, ResourceScopeMode } from "@horae/adrasteia-adapter";
import {
  GovernedExecutionCoordinator,
  type GovernedAnankeBinding,
  type GovernedAdmissionOutcome,
  type GovernedExecutor,
  type GovernedMnemosyneBinding,
  type GovernedExecutionRequest,
  type GovernedPreflightOutcome,
} from "./index.js";

function request(): GovernedExecutionRequest {
  return {
    idempotencyKey: "moirae-request-001",
    sessionRequest: {
      projectId: "project-001",
      profileId: "profile-001",
      task: "admit governed source",
      purpose: "mvp-preflight",
      execution: {
        authenticatedPrincipal: { id: "host", kind: PrincipalKind.Service },
        actingPrincipal: { id: "agent", kind: PrincipalKind.Agent },
        projectId: "project-001",
        runtimeId: "moirae-code",
        sessionId: "session-input",
      },
      scope: { mode: ResourceScopeMode.Bounded, projectId: "project-001", resourceIds: ["source-001"] },
      correlation: { requestId: "request-001", correlationId: "correlation-001" },
      requiredCapabilities: ["content.preflight", "memory.admit"],
    },
    profile: {
      id: "profile-001",
      displayName: "MVP",
      projectId: "project-001",
      requiredRuntimeCapabilities: [],
      allowedRuntimeCapabilities: [],
      auditDestinations: [],
      capabilityExposure: "fixed",
    },
    source: { sourceId: "source-001", canonicalPath: "docs/input.md" },
    content: "governed source",
    contentAccess: { exposure: "SELECTED_CONTENT", destination: "mnemosyne" },
    memoryId: "memory-001",
  };
}

function session(): HoraeSession {
  return {
    id: "session-001",
    composition: {
      id: "composition-001",
      runtimeIds: [],
      capabilityIds: [],
      negotiatedProtocols: {},
      required: [],
      optional: [],
      correlation: { requestId: "request-001", correlationId: "correlation-001" },
      createdAt: "2026-08-24T00:00:00.000Z",
      constraints: [],
    },
    request: request().sessionRequest,
    profile: request().profile,
    capabilityPlan: { visible: [], hidden: [], requiredRuntimeIds: [], optionalRuntimeIds: [] },
    runtimeIds: [],
    startedAt: "2026-08-24T00:00:00.000Z",
  };
}

function coordinator(overrides: {
  ananke?: GovernedAnankeBinding;
  mnemosyne?: GovernedMnemosyneBinding;
  executor?: GovernedExecutor;
  timeoutMs?: number;
} = {}) {
  return new GovernedExecutionCoordinator({
    orchestrator: { start: vi.fn(() => session()) } as unknown as import("./index.js").SessionOrchestrator,
    ananke: overrides.ananke ?? {
      preflight: vi.fn(async (): Promise<GovernedPreflightOutcome> => ({
        action: "ALLOW",
        receipt: { receiptId: "receipt-001" },
        observationId: "observation-001",
        decisionId: "decision-001",
      })),
    } as GovernedAnankeBinding,
    mnemosyne: overrides.mnemosyne ?? {
      admit: vi.fn(async (): Promise<GovernedAdmissionOutcome> => ({
        state: "ADMITTED",
        admissionId: "admission-001",
        candidateId: "candidate-001",
        memoryId: "memory-001",
      })),
    } as GovernedMnemosyneBinding,
    executor: overrides.executor,
    timeoutMs: overrides.timeoutMs,
  });
}

describe("GovernedExecutionCoordinator", () => {
  it("routes a request through composition, Ananke, Mnemosyne, and execution", async () => {
    const executor = { run: vi.fn(async () => ({ ok: true })) };
    const result = await coordinator({ executor }).execute(request());

    expect(result.state).toBe("completed");
    expect(result.history.map((entry) => entry.state)).toEqual([
      "received",
      "composed",
      "preflighted",
      "admitted",
      "executing",
      "completed",
    ]);
    expect(result.output).toEqual({ ok: true });
    expect(executor.run).toHaveBeenCalledOnce();
  });

  it("is idempotent and fails closed when Ananke does not provide a receipt", async () => {
    const ananke: GovernedAnankeBinding = { preflight: vi.fn(async (): Promise<GovernedPreflightOutcome> => ({ action: "ALLOW" })) };
    const mnemosyne: GovernedMnemosyneBinding = { admit: vi.fn() };
    const route = coordinator({ ananke, mnemosyne });
    const first = await route.execute(request());
    const second = await route.execute(request());

    expect(first.state).toBe("quarantined");
    expect(second).toEqual(first);
    expect(mnemosyne.admit).not.toHaveBeenCalled();
  });

  it("reports cancellation and permits explicit recovery", async () => {
    let release!: () => void;
    let calls = 0;
    const ananke: GovernedAnankeBinding = {
      preflight: vi.fn((): Promise<GovernedPreflightOutcome> => {
        calls += 1;
        if (calls === 1) return new Promise<GovernedPreflightOutcome>((resolve) => { release = () => resolve({ action: "ALLOW", receipt: {} }); });
        return Promise.resolve({ action: "ALLOW", receipt: {} });
      }),
    };
    const route = coordinator({ ananke });
    const controller = new AbortController();
    const pending = route.execute(request(), controller.signal);
    controller.abort();
    const cancelled = await pending;
    expect(cancelled.state).toBe("cancelled");
    release();

    const recovered = await route.recover(request());
    expect(recovered.state).toBe("completed");
    expect(recovered.recoveredFrom).toBe("request-001");
  });

  it("converts an executor timeout into a recoverable terminal state", async () => {
    const route = coordinator({ timeoutMs: 5, executor: { run: () => new Promise<never>(() => undefined) } });
    const result = await route.execute(request());
    expect(result.state).toBe("timed_out");
    expect(result.retryable).toBe(true);
  });
});
