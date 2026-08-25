import { describe, expect, it, vi } from "vitest";
import type { HoraeSession } from "@horae/schema";
import { PrincipalKind, ResourceScopeMode } from "@horae/adrasteia-adapter";
import {
  GovernedExecutionCoordinator,
  type GovernedAnankeBinding,
  type GovernedAdmissionOutcome,
  type GovernedExecutor,
  type GovernedExecutionRecord,
  type GovernedAdmissionInput,
  type GovernedMnemosyneBinding,
  type GovernedExecutionRequest,
  type GovernedPreflightOutcome,
  type SessionOrchestrator,
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
      scope: {
        mode: ResourceScopeMode.Bounded,
        projectId: "project-001",
        resourceIds: ["source-001"],
      },
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

function requestVariant(
  overrides: {
    idempotencyKey?: string;
    requestId?: string;
    correlationId?: string;
    projectId?: string;
    tenantId?: string;
    workspaceId?: string;
    resourceId?: string;
    memoryId?: string;
    content?: unknown;
  } = {},
): GovernedExecutionRequest {
  const base = request();
  const requestId = overrides.requestId ?? base.sessionRequest.correlation.requestId;
  const projectId = overrides.projectId ?? base.sessionRequest.projectId;
  const correlationId = overrides.correlationId ?? `correlation-${requestId}`;
  const execution = {
    ...base.sessionRequest.execution,
    projectId,
    ...(overrides.tenantId === undefined ? {} : { tenantId: overrides.tenantId }),
    ...(overrides.workspaceId === undefined ? {} : { workspaceId: overrides.workspaceId }),
  };
  const scope = {
    ...base.sessionRequest.scope,
    projectId,
    resourceIds: [overrides.resourceId ?? `${projectId}-source`],
    ...(overrides.tenantId === undefined ? {} : { tenantId: overrides.tenantId }),
    ...(overrides.workspaceId === undefined ? {} : { workspaceId: overrides.workspaceId }),
  };
  return {
    ...base,
    idempotencyKey: overrides.idempotencyKey ?? base.idempotencyKey,
    profile: { ...base.profile, projectId },
    memoryId: overrides.memoryId ?? `memory-${requestId}`,
    content: overrides.content ?? base.content,
    sessionRequest: {
      ...base.sessionRequest,
      projectId,
      execution,
      scope,
      correlation: { requestId, correlationId },
    },
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

function coordinator(
  overrides: {
    ananke?: GovernedAnankeBinding;
    mnemosyne?: GovernedMnemosyneBinding;
    executor?: GovernedExecutor;
    timeoutMs?: number;
    orchestrator?: SessionOrchestrator;
  } = {},
) {
  const orchestrator =
    overrides.orchestrator ??
    ({
      start: vi.fn((input: HoraeSession["request"]) => {
        const base = session();
        const sessionId = `session-${input.correlation.requestId}`;
        return {
          ...base,
          id: sessionId,
          request: input,
          composition: {
            ...base.composition,
            id: `composition-${input.correlation.requestId}`,
            correlation: { ...input.correlation, sessionId },
          },
        };
      }),
    } as unknown as SessionOrchestrator);
  return new GovernedExecutionCoordinator({
    orchestrator,
    ananke:
      overrides.ananke ??
      ({
        preflight: vi.fn(async (): Promise<GovernedPreflightOutcome> => ({
          action: "ALLOW",
          receipt: { receiptId: "receipt-001" },
          observationId: "observation-001",
          decisionId: "decision-001",
        })),
      } as GovernedAnankeBinding),
    mnemosyne:
      overrides.mnemosyne ??
      ({
        admit: vi.fn(
          async ({
            request: input,
          }: GovernedAdmissionInput): Promise<GovernedAdmissionOutcome> => ({
            state: "ADMITTED",
            admissionId: "admission-001",
            candidateId: "candidate-001",
            memoryId: input.memoryId,
          }),
        ),
      } as GovernedMnemosyneBinding),
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
    const ananke: GovernedAnankeBinding = {
      preflight: vi.fn(async (): Promise<GovernedPreflightOutcome> => ({ action: "ALLOW" })),
    };
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
        if (calls === 1)
          return new Promise<GovernedPreflightOutcome>((resolve) => {
            release = () => resolve({ action: "ALLOW", receipt: {} });
          });
        return Promise.resolve<GovernedPreflightOutcome>({ action: "ALLOW", receipt: {} });
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

  it("marks an executor timeout as unknown-effect recovery-required", async () => {
    const route = coordinator({
      timeoutMs: 5,
      executor: { run: () => new Promise<never>(() => undefined) },
    });
    const result = await route.execute(request());
    expect(result.state).toBe("recovery_required");
    expect(result.reason).toBe("horae_timeout_effect_outcome_unknown");
    expect(result.retryable).toBe(false);
    await expect(route.recover(request())).rejects.toThrow("reconciliation required");
  });

  it("P0-A blocks a duplicate effect after timeout and recovery", async () => {
    let releaseFirstEffect!: () => void;
    let sideEffects = 0;
    let calls = 0;
    const firstEffect = new Promise<void>((resolve) => {
      releaseFirstEffect = resolve;
    });
    const executor: GovernedExecutor = {
      run: vi.fn(async () => {
        calls += 1;
        if (calls === 1) await firstEffect;
        sideEffects += 1;
        return { sideEffects };
      }),
    };
    const route = coordinator({ timeoutMs: 5, executor });

    const timedOut = await route.execute(request());
    expect(timedOut.state).toBe("recovery_required");
    expect(timedOut.reason).toBe("horae_timeout_effect_outcome_unknown");
    expect(timedOut.retryable).toBe(false);
    expect(sideEffects).toBe(0);

    releaseFirstEffect();
    await vi.waitFor(() => expect(sideEffects).toBe(1));

    await expect(route.recover(request())).rejects.toThrow("reconciliation required");
    expect(sideEffects).toBe(1);
  });

  it("refuses recovery when an executor observes abort only after its effect", async () => {
    let sideEffects = 0;
    const executor: GovernedExecutor = {
      run: vi.fn(async ({ signal }) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        sideEffects += 1;
        return { observedAbortAfterEffect: signal.aborted };
      }),
    };
    const route = coordinator({ timeoutMs: 5, executor });

    const result = await route.execute(request());
    expect(result.state).toBe("recovery_required");
    expect(result.retryable).toBe(false);
    await vi.waitFor(() => expect(sideEffects).toBe(1));
    await expect(route.recover(request())).rejects.toThrow("reconciliation required");
    expect(executor.run).toHaveBeenCalledOnce();
  });

  it("does not retry an executor that completes successfully just after timeout", async () => {
    let releaseLateCompletion!: () => void;
    let sideEffects = 0;
    const lateCompletion = new Promise<void>((resolve) => {
      releaseLateCompletion = resolve;
    });
    const executor: GovernedExecutor = {
      run: vi.fn(async () => {
        await lateCompletion;
        sideEffects += 1;
        return { ok: true };
      }),
    };
    const route = coordinator({ timeoutMs: 5, executor });

    const result = await route.execute(request());
    expect(result.state).toBe("recovery_required");
    releaseLateCompletion();
    await vi.waitFor(() => expect(sideEffects).toBe(1));
    expect(route.get(request())).toMatchObject({ state: "recovery_required", retryable: false });
    await expect(route.recover(request())).rejects.toThrow("reconciliation required");
    expect(sideEffects).toBe(1);
  });

  it("refuses two concurrent recoveries after an unknown-effect cancellation", async () => {
    let releaseEffect!: () => void;
    let sideEffects = 0;
    const effect = new Promise<void>((resolve) => {
      releaseEffect = resolve;
    });
    const executor: GovernedExecutor = {
      run: vi.fn(async () => {
        await effect;
        sideEffects += 1;
        return { ok: true };
      }),
    };
    const route = coordinator({ timeoutMs: 1_000, executor });
    const controller = new AbortController();
    const pending = route.execute(request(), controller.signal);
    await vi.waitFor(() => expect(executor.run).toHaveBeenCalledOnce());
    controller.abort();
    const cancelled = await pending;

    expect(cancelled.state).toBe("recovery_required");
    expect(cancelled.reason).toBe("horae_cancelled_effect_outcome_unknown");
    releaseEffect();
    await vi.waitFor(() => expect(sideEffects).toBe(1));

    const recoveries = await Promise.allSettled([
      route.recover(request()),
      route.recover(request()),
    ]);
    expect(recoveries.every(({ status }) => status === "rejected")).toBe(true);
    expect(executor.run).toHaveBeenCalledOnce();
    expect(sideEffects).toBe(1);
  });

  it("preserves cancellation recovery before executor dispatch", async () => {
    let releasePreflight!: () => void;
    let calls = 0;
    const ananke: GovernedAnankeBinding = {
      preflight: vi.fn(() => {
        calls += 1;
        if (calls === 1) {
          return new Promise<GovernedPreflightOutcome>((resolve) => {
            releasePreflight = () => resolve({ action: "ALLOW", receipt: {} });
          });
        }
        return Promise.resolve<GovernedPreflightOutcome>({ action: "ALLOW", receipt: {} });
      }),
    };
    const executor: GovernedExecutor = { run: vi.fn(async () => ({ ok: true })) };
    const route = coordinator({ ananke, executor, timeoutMs: 5 });

    const timedOut = await route.execute(request());
    expect(timedOut.state).toBe("timed_out");
    expect(timedOut.retryable).toBe(true);
    releasePreflight();
    const recovered = await route.recover(request());

    expect(recovered.state).toBe("completed");
    expect(executor.run).toHaveBeenCalledOnce();
  });

  it("does not retry an executor failure after dispatch without effect evidence", async () => {
    const route = coordinator({
      executor: {
        run: async () => {
          throw new Error("provider connection lost");
        },
      },
    });
    const result = await route.execute(request());

    expect(result.state).toBe("recovery_required");
    expect(result.retryable).toBe(false);
    await expect(route.recover(request())).rejects.toThrow("reconciliation required");
  });

  it("rejects a different request that collides with an in-flight idempotency key", async () => {
    let release!: () => void;
    const ananke: GovernedAnankeBinding = {
      preflight: vi.fn(
        () =>
          new Promise<GovernedPreflightOutcome>((resolve) => {
            release = () => resolve({ action: "ALLOW", receipt: {} });
          }),
      ),
    };
    const route = coordinator({ ananke });
    const first = route.execute(request());
    const second = route.execute({
      ...request(),
      sessionRequest: {
        ...request().sessionRequest,
        correlation: { requestId: "request-002", correlationId: "correlation-002" },
      },
    });
    await expect(second).rejects.toThrow("idempotency key is bound to another in-flight request");
    release();
    await expect(first).resolves.toMatchObject({ requestId: "request-001" });
  });

  it("isolates the same idempotency key across projects and deduplicates a genuine retry", async () => {
    const route = coordinator();
    const first = await route.execute(request());
    const retry = await route.execute(request());
    const otherProject = request();
    otherProject.sessionRequest = {
      ...otherProject.sessionRequest,
      projectId: "project-002",
      execution: { ...otherProject.sessionRequest.execution, projectId: "project-002" },
      scope: { ...otherProject.sessionRequest.scope, projectId: "project-002" },
      correlation: { requestId: "request-002", correlationId: "correlation-002" },
    };
    const other = await route.execute(otherProject);

    expect(retry).toEqual(first);
    expect(other.requestId).toBe("request-002");
    expect(other.state).toBe("completed");
    expect(other).not.toEqual(first);
  });

  it("HGET-01 rejects key-only cross-binding retrieval", async () => {
    const executor: GovernedExecutor = {
      run: vi.fn(async ({ request: input }) => ({
        requestId: input.sessionRequest.correlation.requestId,
        secret: `output-${input.sessionRequest.correlation.requestId}`,
      })),
    };
    const route = coordinator({ executor });
    const callerA = requestVariant({
      requestId: "request-a",
      resourceId: "source-a",
      memoryId: "memory-a",
    });
    const callerB = requestVariant({
      requestId: "request-b",
      resourceId: "source-b",
      memoryId: "memory-b",
    });

    await route.execute(callerA);
    await route.execute(callerB);

    expect(route.get(callerA)).toMatchObject({ requestId: "request-a", memoryId: "memory-a" });
    expect(route.get(callerB)).toMatchObject({ requestId: "request-b", memoryId: "memory-b" });
    expect(
      route.get({
        ...callerB,
        sessionRequest: {
          ...callerB.sessionRequest,
          correlation: { requestId: "request-a", correlationId: "correlation-a" },
        },
      }),
    ).toBeUndefined();
  });

  it("HGET-02 requires the exact request ID for same-key records", async () => {
    const route = coordinator();
    const callerA = requestVariant({ requestId: "request-a", resourceId: "source-a" });
    const callerB = requestVariant({ requestId: "request-b", resourceId: "source-b" });
    await route.execute(callerA);
    await route.execute(callerB);

    expect(route.get(callerA)?.requestId).toBe("request-a");
    expect(route.get(callerB)?.requestId).toBe("request-b");
    expect(
      route.get({
        ...callerB,
        sessionRequest: {
          ...callerB.sessionRequest,
          correlation: { requestId: "request-a", correlationId: "correlation-a" },
        },
      }),
    ).toBeUndefined();
  });

  it("HGET-03 isolates same-key records across projects", async () => {
    const route = coordinator();
    const projectA = requestVariant({
      requestId: "request-project-a",
      projectId: "project-a",
      resourceId: "source-project-a",
    });
    const projectB = requestVariant({
      requestId: "request-project-b",
      projectId: "project-b",
      resourceId: "source-project-b",
    });
    await route.execute(projectA);
    await route.execute(projectB);

    expect(route.get(projectA)?.requestId).toBe("request-project-a");
    expect(route.get(projectB)?.requestId).toBe("request-project-b");
    expect(
      route.get({
        ...projectB,
        sessionRequest: {
          ...projectB.sessionRequest,
          correlation: { requestId: "request-project-a", correlationId: "correlation-project-a" },
        },
      }),
    ).toBeUndefined();
  });

  it("HGET-04 isolates same-key records across tenant and workspace scope", async () => {
    const route = coordinator();
    const scopeA = requestVariant({
      requestId: "request-scope-a",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      resourceId: "source-scope-a",
    });
    const scopeB = requestVariant({
      requestId: "request-scope-b",
      tenantId: "tenant-b",
      workspaceId: "workspace-b",
      resourceId: "source-scope-b",
    });
    await route.execute(scopeA);
    await route.execute(scopeB);

    expect(route.get(scopeA)?.requestId).toBe("request-scope-a");
    expect(route.get(scopeB)?.requestId).toBe("request-scope-b");
    expect(
      route.get({
        ...scopeB,
        sessionRequest: {
          ...scopeB.sessionRequest,
          correlation: { requestId: "request-scope-a", correlationId: "correlation-scope-a" },
        },
      }),
    ).toBeUndefined();
  });

  it("HGET-05 retrieves a completed record for the correct request and scope", async () => {
    const route = coordinator();
    const ownRequest = requestVariant({ requestId: "request-own", resourceId: "source-own" });
    await route.execute(ownRequest);

    expect(route.get(ownRequest)).toMatchObject({
      requestId: "request-own",
      idempotencyKey: ownRequest.idempotencyKey,
      state: "completed",
      sessionId: "session-request-own",
    });
  });

  it("HGET-06 preserves deterministic genuine retry deduplication", async () => {
    const executor: GovernedExecutor = { run: vi.fn(async () => ({ ok: true })) };
    const route = coordinator({ executor });
    const ownRequest = requestVariant({ requestId: "request-retry", resourceId: "source-retry" });
    const first = await route.execute(ownRequest);
    const retry = await route.execute(ownRequest);

    expect(retry).toEqual(first);
    expect(route.get(ownRequest)).toEqual(first);
    expect(executor.run).toHaveBeenCalledOnce();
  });

  it("HGET-07 applies the same identity and scope rules in-flight and after completion", async () => {
    let releaseA!: () => void;
    let releaseB!: () => void;
    let calls = 0;
    const ananke: GovernedAnankeBinding = {
      preflight: vi.fn(
        () =>
          new Promise<GovernedPreflightOutcome>((resolve) => {
            calls += 1;
            if (calls === 1)
              releaseA = () => resolve({ action: "ALLOW", receipt: { caller: "a" } });
            else releaseB = () => resolve({ action: "ALLOW", receipt: { caller: "b" } });
          }),
      ),
    };
    const route = coordinator({ ananke });
    const callerA = requestVariant({
      requestId: "request-flight-a",
      resourceId: "source-flight-a",
    });
    const callerB = requestVariant({
      requestId: "request-flight-b",
      resourceId: "source-flight-b",
    });
    const pendingA = route.execute(callerA);
    const pendingB = route.execute(callerB);
    const retryA = route.execute(callerA);
    const differentRequestSameBinding = requestVariant({
      requestId: "request-flight-a-other",
      resourceId: "source-flight-a",
      memoryId: "memory-request-flight-a",
    });

    expect(retryA).toBe(pendingA);
    await expect(route.execute(differentRequestSameBinding)).rejects.toThrow(
      "idempotency key is bound to another in-flight request",
    );
    releaseB();
    releaseA();
    await Promise.all([pendingA, pendingB]);

    expect(route.get(callerA)?.requestId).toBe("request-flight-a");
    expect(route.get(callerB)?.requestId).toBe("request-flight-b");
    expect(route.get(differentRequestSameBinding)).toBeUndefined();
  });

  it("HGET-08 makes ambiguous key-only lookup unavailable and fail closed", async () => {
    const route = coordinator();
    const callerA = requestVariant({
      requestId: "request-ambiguous-a",
      resourceId: "source-ambiguous-a",
    });
    const callerB = requestVariant({
      requestId: "request-ambiguous-b",
      resourceId: "source-ambiguous-b",
    });
    await route.execute(callerA);
    await route.execute(callerB);

    const keyOnlyLookup = route.get.bind(route) as unknown as (
      idempotencyKey: string,
    ) => GovernedExecutionRecord | undefined;
    expect(() => keyOnlyLookup(callerA.idempotencyKey)).toThrow(
      "governed execution request is required",
    );
  });

  it("HGET-09 prevents wrong-caller output, memory, and session disclosure", async () => {
    const executor: GovernedExecutor = {
      run: vi.fn(async ({ request: input }) => ({
        secret: `output-${input.sessionRequest.correlation.requestId}`,
      })),
    };
    const route = coordinator({ executor });
    const callerA = requestVariant({
      requestId: "request-secret-a",
      resourceId: "source-secret-a",
      memoryId: "memory-secret-a",
    });
    const callerB = requestVariant({
      requestId: "request-secret-b",
      resourceId: "source-secret-b",
      memoryId: "memory-secret-b",
    });
    await route.execute(callerA);
    await route.execute(callerB);

    const wrongCaller = route.get({
      ...callerB,
      sessionRequest: {
        ...callerB.sessionRequest,
        correlation: { requestId: "request-secret-a", correlationId: "correlation-secret-a" },
      },
    });
    expect(wrongCaller).toBeUndefined();
    expect(wrongCaller?.output).toBeUndefined();
    expect(wrongCaller?.memoryId).toBeUndefined();
    expect(wrongCaller?.sessionId).toBeUndefined();
  });

  it("keeps completed and in-flight identity checks equivalent under reverse completion", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let calls = 0;
    const ananke: GovernedAnankeBinding = {
      preflight: vi.fn(
        () =>
          new Promise<GovernedPreflightOutcome>((resolve) => {
            calls += 1;
            if (calls === 1)
              releaseFirst = () => resolve({ action: "ALLOW", receipt: { route: 1 } });
            else releaseSecond = () => resolve({ action: "ALLOW", receipt: { route: 2 } });
          }),
      ),
    };
    const route = coordinator({ ananke });
    const firstRequest = request();
    const secondRequest = {
      ...request(),
      idempotencyKey: "moirae-request-002",
      sessionRequest: {
        ...request().sessionRequest,
        correlation: { requestId: "request-002", correlationId: "correlation-002" },
      },
    };
    const first = route.execute(firstRequest);
    const second = route.execute(secondRequest);
    releaseSecond();
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.requestId).toBe("request-001");
    expect(secondResult.requestId).toBe("request-002");
    await expect(
      route.execute({
        ...firstRequest,
        sessionRequest: {
          ...firstRequest.sessionRequest,
          correlation: { requestId: "request-003", correlationId: "correlation-003" },
        },
      }),
    ).rejects.toThrow("idempotency key is bound to another request");
  });
});
