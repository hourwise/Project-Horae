import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PrincipalKind, ResourceScopeMode } from "@horae/adrasteia-adapter";
import {
  FileDurableExecutionStateStore,
  GovernedExecutionCrash,
  GovernedExecutionCoordinator,
  type GovernedExecutionRequest,
  type GovernedExecutionFaultPoint,
} from "./index.js";

function request(content = "durable governed source"): GovernedExecutionRequest {
  return {
    idempotencyKey: "durable-operation-001",
    sessionRequest: {
      projectId: "project-durable",
      profileId: "profile-durable",
      task: "admit durable source",
      purpose: "governed.memory-admission",
      execution: {
        authenticatedPrincipal: { id: "service-durable", kind: PrincipalKind.Service },
        actingPrincipal: { id: "agent-durable", kind: PrincipalKind.Agent },
        projectId: "project-durable",
        runtimeId: "moirae-code",
        sessionId: "session-input",
      },
      scope: {
        mode: ResourceScopeMode.Bounded,
        projectId: "project-durable",
        resourceIds: ["source-durable"],
      },
      correlation: { requestId: "request-durable-001", correlationId: "correlation-durable-001" },
      requiredCapabilities: ["content.preflight", "memory.admit"],
    },
    profile: {
      id: "profile-durable",
      displayName: "Durable test profile",
      projectId: "project-durable",
      requiredRuntimeCapabilities: [],
      allowedRuntimeCapabilities: [],
      auditDestinations: [],
      capabilityExposure: "fixed",
    },
    source: { sourceId: "source-durable", canonicalPath: "docs/durable.md" },
    content,
    contentAccess: { exposure: "SELECTED_CONTENT", destination: "mnemosyne" },
    memoryId: "memory-durable-001",
  };
}

function makeCoordinator(
  filePath: string,
  effect: { attempts: number; successes: number; completed: Set<string>; inFlight: boolean; block?: Promise<void> },
  options: { crash?: (point: GovernedExecutionFaultPoint) => void; effectReconciler?: boolean; failEffect?: boolean } = {},
) {
  return new GovernedExecutionCoordinator({
    orchestrator: {
      start: (input: any) => ({
        id: `session-${input.correlation.requestId}`,
        composition: { id: `composition-${input.correlation.requestId}` },
        request: input,
        profile: request().profile,
        capabilityPlan: { visible: [], hidden: [], requiredRuntimeIds: [], optionalRuntimeIds: [] },
        runtimeIds: [],
        startedAt: "2026-08-27T12:00:00.000Z",
      }),
    } as never,
    ananke: { preflight: async () => ({ action: "ALLOW", receipt: { receiptId: "receipt-durable" }, observationId: "observation-durable", decisionId: "decision-durable" }) },
    mnemosyne: { admit: async ({ request: input }) => ({ state: "ADMITTED", admissionId: "admission-durable", candidateId: "candidate-durable", memoryId: input.memoryId }) },
    executor: {
      run: async ({ effectId }) => {
        if (!effectId) throw new Error("effect identity missing");
        effect.attempts += 1;
        effect.inFlight = true;
        if (effect.completed.has(effectId)) throw new Error("duplicate controlled effect invocation");
        if (effect.block) await effect.block;
        if (options.failEffect) {
          effect.inFlight = false;
          throw new Error("controlled effect failed before success");
        }
        effect.completed.add(effectId);
        effect.successes += 1;
        effect.inFlight = false;
        return { effectId, result: "controlled-success" };
      },
    },
    stateStore: new FileDurableExecutionStateStore({ filePath }),
    effectReconciler: options.effectReconciler === false ? undefined : {
      reconcile: async ({ effectId }) => {
        if (effect.inFlight) return { status: "UNKNOWN" as const };
        return effect.completed.has(effectId)
          ? { status: "CONFIRMED" as const, output: { effectId, result: "controlled-success" } }
          : { status: "ABSENT" as const };
      },
    },
    faultInjector: options.crash,
    now: () => "2026-08-27T12:00:00.000Z",
  });
}

function tempStatePath(): string {
  return join(mkdtempSync(join(tmpdir(), "horae-005d-durable-")), "execution.json");
}

function rewriteState(filePath: string, mutate: (document: any) => void): void {
  const document = JSON.parse(readFileSync(filePath, "utf8"));
  mutate(document);
  const unsigned = {
    schemaVersion: document.schemaVersion,
    records: document.records,
    idempotencyBindings: document.idempotencyBindings,
  };
  document.checksum = `sha256:${createHash("sha256").update(stableJson(unsigned), "utf8").digest("hex")}`;
  writeFileSync(filePath, JSON.stringify(document), "utf8");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

describe("durable governed execution", () => {
  it.each([
    ["after_receipt_before_authority", false],
    ["after_authority_before_admission", false],
    ["after_admission_before_intent", false],
    ["after_intent_before_effect", false],
    ["before_effect_invocation", false],
    ["after_effect_failure_before_recovery_record", true],
    ["after_effect_success_before_record", false],
    ["after_effect_confirmed_before_completed", false],
    ["after_completion_before_response", false],
  ] as const)("recovers safely across the crash boundary %s", async (point, failEffect) => {
    const filePath = tempStatePath();
    const effect = { attempts: 0, successes: 0, completed: new Set<string>(), inFlight: false };
    const crash = (observed: GovernedExecutionFaultPoint) => {
      if (observed === point) throw new GovernedExecutionCrash(observed);
    };

    await expect(makeCoordinator(filePath, effect, { crash, failEffect }).execute(request())).rejects.toThrow("simulated governed execution crash");

    const recovered = await makeCoordinator(filePath, effect).execute(request());
    expect(recovered.state).toBe("completed");
    expect(effect.successes).toBe(1);
    expect(effect.attempts).toBe(failEffect ? 2 : 1);
  });

  it("reconciles a successful effect after a crash before durable completion", async () => {
    const filePath = tempStatePath();
    const effect = { attempts: 0, successes: 0, completed: new Set<string>(), inFlight: false };
    const crash = (point: GovernedExecutionFaultPoint) => {
      if (point === "after_effect_success_before_record") throw new GovernedExecutionCrash(point);
    };

    await expect(makeCoordinator(filePath, effect, { crash }).execute(request())).rejects.toThrow("simulated governed execution crash");
    expect(effect).toMatchObject({ attempts: 1, successes: 1 });

    const recovered = await makeCoordinator(filePath, effect).execute(request());
    expect(recovered.state).toBe("completed");
    expect(recovered.effectStatus).toBe("confirmed");
    expect(recovered.history.map(({ state }) => state)).toContain("effect_attempted");
    expect(effect).toMatchObject({ attempts: 1, successes: 1 });
    expect(await makeCoordinator(filePath, effect).execute(request())).toEqual(recovered);

    await expect(makeCoordinator(filePath, effect).execute(request("mutated after restart"))).rejects.toThrow("IDEMPOTENCY_BINDING_MISMATCH");
  });

  it("recovers a durable intent that is proven not to have reached the effect", async () => {
    const filePath = tempStatePath();
    const effect = { attempts: 0, successes: 0, completed: new Set<string>(), inFlight: false };
    const crash = (point: GovernedExecutionFaultPoint) => {
      if (point === "before_effect_invocation") throw new GovernedExecutionCrash(point);
    };

    await expect(makeCoordinator(filePath, effect, { crash }).execute(request())).rejects.toThrow("simulated governed execution crash");
    expect(effect).toMatchObject({ attempts: 0, successes: 0 });
    const recovered = await makeCoordinator(filePath, effect).execute(request());
    expect(recovered.state).toBe("completed");
    expect(effect).toMatchObject({ attempts: 1, successes: 1 });
  });

  it("fails closed when effect outcome remains unknown", async () => {
    const filePath = tempStatePath();
    const effect = { attempts: 0, successes: 0, completed: new Set<string>(), inFlight: false };
    const crash = (point: GovernedExecutionFaultPoint) => {
      if (point === "after_effect_success_before_record") throw new GovernedExecutionCrash(point);
    };
    await expect(makeCoordinator(filePath, effect, { crash, effectReconciler: false }).execute(request())).rejects.toThrow("simulated governed execution crash");
    expect(effect.successes).toBe(1);
    const restarted = makeCoordinator(filePath, effect, { effectReconciler: false });
    const replay = await restarted.execute(request());
    expect(replay.state).toBe("recovery_required");
    expect(replay.retryable).toBe(false);
    expect(effect.attempts).toBe(1);
  });

  it("does not let concurrent recovery retry while the effect is still in flight", async () => {
    const filePath = tempStatePath();
    let release!: () => void;
    const block = new Promise<void>((resolve) => { release = resolve; });
    const effect = { attempts: 0, successes: 0, completed: new Set<string>(), inFlight: false, block };
    const first = makeCoordinator(filePath, effect);
    const second = makeCoordinator(filePath, effect);
    const firstRun = first.execute(request());
    await new Promise((resolve) => setTimeout(resolve, 10));
    const secondRun = second.execute(request());
    release();
    const [left, right] = await Promise.all([firstRun, secondRun]);
    expect(effect.attempts).toBe(1);
    expect(effect.successes).toBe(1);
    expect([left.state, right.state]).toEqual(["recovery_required", "recovery_required"]);
    expect((await makeCoordinator(filePath, effect).execute(request())).state).toBe("completed");
  });

  it.each(["", "{\"schemaVersion\":999}", "not-json"])("fails closed on corrupted durable state: %s", async (contents) => {
    const filePath = tempStatePath();
    writeFileSync(filePath, contents, "utf8");
    await expect(makeCoordinator(filePath, { attempts: 0, successes: 0, completed: new Set(), inFlight: false }).execute(request())).rejects.toThrow(/durable execution state/);
  });

  it("fails closed on a tampered checksum instead of starting a new operation", async () => {
    const filePath = tempStatePath();
    const effect = { attempts: 0, successes: 0, completed: new Set<string>(), inFlight: false };
    await makeCoordinator(filePath, effect).execute(request());
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    parsed.records[0].record.requestId = "tampered-request";
    writeFileSync(filePath, JSON.stringify(parsed), "utf8");
    await expect(makeCoordinator(filePath, effect).execute(request())).rejects.toThrow("checksum mismatch");
    expect(effect.attempts).toBe(1);
  });

  it.each([
    ["malformed record", (document: any) => { document.records[0].record.state = 42; }],
    ["impossible lifecycle transition", (document: any) => { document.records[0].record.history.push({ state: "received", occurredAt: "2026-08-27T12:00:00.000Z" }); }],
    ["operation binding mismatch", (document: any) => { document.records[0].bindingDigest = `sha256:${"a".repeat(64)}`; }],
    ["effect identity mismatch", (document: any) => { document.records[0].record.effectId = `effect:sha256:${"b".repeat(64)}`; }],
    ["caller binding mismatch", (document: any) => { document.idempotencyBindings[0].requestId = "different-caller"; }],
    ["conflicting duplicate record", (document: any) => { document.records.push({ ...document.records[0] }); }],
  ] as const)("fails closed on persisted %s", async (_label, mutate) => {
    const filePath = tempStatePath();
    const effect = { attempts: 0, successes: 0, completed: new Set<string>(), inFlight: false };
    await makeCoordinator(filePath, effect).execute(request());
    rewriteState(filePath, mutate);
    await expect(makeCoordinator(filePath, effect).execute(request())).rejects.toThrow(/durable execution|illegal durable execution/);
    expect(effect.attempts).toBe(1);
  });

  it("rejects a changed governed scope after restart instead of inheriting the old record", async () => {
    const filePath = tempStatePath();
    const effect = { attempts: 0, successes: 0, completed: new Set<string>(), inFlight: false };
    await makeCoordinator(filePath, effect).execute(request());
    const changedScope = request();
    changedScope.sessionRequest.scope = { ...changedScope.sessionRequest.scope, resourceIds: ["different-source"] };
    await expect(makeCoordinator(filePath, effect).execute(changedScope)).rejects.toThrow("IDEMPOTENCY_BINDING_MISMATCH");
    expect(effect.attempts).toBe(1);
  });
});
