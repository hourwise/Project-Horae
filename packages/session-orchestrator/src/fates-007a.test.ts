import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeFates007aAuthorityInstanceDigest,
  computeFates007aClaimDigest,
  computeFates007aDurableExecutionId,
  createFates007aReceipt,
  FileFates007aExecutionStore,
  Fates007aExecutionCoordinator,
  type FatesAuthorityEnvelopeV1,
  type FatesClaimAwareAnankeBinding,
  type FatesClaimV1,
  type FatesEffectReceiptV1,
} from "./fates-007a.js";

const NOW = "2026-09-03T10:00:00.000Z";
const LATER = "2026-09-03T10:01:00.000Z";
const OPERATION = { server: "synthetic", toolName: "synthetic.write", version: "1.0.0" };
const CONTEXT = {
  authenticatedPrincipal: { id: "synthetic-workload", kind: "service", tenantId: "tenant-007a" },
  actingPrincipal: { id: "synthetic-agent", kind: "agent", tenantId: "tenant-007a" },
  representedPrincipal: { id: "synthetic-requester", kind: "human", tenantId: "tenant-007a" },
  runtimeId: "ananke",
  runtimeInstanceId: "ananke-007a",
  sessionId: "session-007a",
  tenantId: "tenant-007a",
  projectId: "project-007a",
  workspaceId: "workspace-007a",
  resourceScope: {
    mode: "bounded",
    tenantId: "tenant-007a",
    resourceType: "synthetic",
    resourceIds: ["recipient-1"],
    operations: ["write"],
    providerNamespace: "offline",
  },
  correlation: {
    requestId: "request-007a",
    correlationId: "correlation-007a",
    causationId: "cause-007a",
  },
  policyVersion: "builtin:0.1.0",
  purpose: "synthetic FATES-007A acceptance",
};
const ADAPTER = { id: "synthetic-offline", version: "1.0.0" };
const APPROVAL_A = {
  grantId: "grant-a",
  approvalActionHash: "a".repeat(64),
  approvalBindingHash: "b".repeat(64),
  expiresAt: "2026-09-03T10:05:00.000Z",
  operatorId: "operator-1",
  operatorSessionId: "operator-session-1",
};

function authority(overrides: Partial<FatesAuthorityEnvelopeV1> = {}): FatesAuthorityEnvelopeV1 {
  const base = {
    schemaVersion: "1" as const,
    operation: OPERATION,
    nativeActionHash: "c".repeat(64),
    approval: APPROVAL_A,
    authenticatedContext: CONTEXT,
    requestIdentity: CONTEXT.correlation,
    resourceScope: CONTEXT.resourceScope,
    purpose: CONTEXT.purpose,
    policyVersion: CONTEXT.policyVersion,
    argumentsDigest: "sha256:" + "d".repeat(64),
    targetDigest: "sha256:" + "e".repeat(64),
    effectAdapter: ADAPTER,
  };
  const withoutIds = { ...base, ...overrides } as Omit<
    FatesAuthorityEnvelopeV1,
    "durableExecutionId" | "authorityInstanceDigest" | "approval"
  >;
  const durableExecutionId = computeFates007aDurableExecutionId(withoutIds);
  const withDurable = { ...base, ...overrides, durableExecutionId } as FatesAuthorityEnvelopeV1;
  return {
    ...withDurable,
    authorityInstanceDigest: computeFates007aAuthorityInstanceDigest(withDurable),
  };
}

function receiptFor(
  input: FatesAuthorityEnvelopeV1,
  result: "CONFIRMED" | "ABSENT" | "UNKNOWN",
): FatesEffectReceiptV1 {
  return createFates007aReceipt({
    durableExecutionId: input.durableExecutionId,
    nativeActionHash: input.nativeActionHash,
    operation: input.operation,
    authorityInstanceDigest: input.authorityInstanceDigest,
    effectAdapter: input.effectAdapter,
    argumentsDigest: input.argumentsDigest,
    targetDigest: input.targetDigest,
    providerOperationId: result === "UNKNOWN" ? undefined : "synthetic-op-1",
    providerIdempotencyKey: `synthetic:${input.durableExecutionId}`,
    result,
    receiptProvenance: "synthetic-offline-authoritative",
    observedAt: NOW,
  });
}

function claimFor(
  input: FatesAuthorityEnvelopeV1,
  owner = "pid:test:one",
  generation = 1,
): FatesClaimV1 {
  const unsigned = {
    schemaVersion: "1" as const,
    durableExecutionId: input.durableExecutionId,
    owner,
    generation,
    claimedAt: NOW,
    nativeActionHash: input.nativeActionHash,
    authorityInstanceDigest: input.authorityInstanceDigest,
    argumentsDigest: input.argumentsDigest,
    operation: input.operation,
    effectAdapter: input.effectAdapter,
  };
  return { ...unsigned, claimDigest: computeFates007aClaimDigest(unsigned) };
}

function statePath(): string {
  return join(mkdtempSync(join(tmpdir(), "horae-fates-007a-")), "execution.json");
}

function binding(
  mode: { execute: FatesEffectReceiptV1; reconcile: FatesEffectReceiptV1 },
  calls: { execute: number; reconcile: number },
): FatesClaimAwareAnankeBinding {
  return {
    async executeClaimed() {
      calls.execute += 1;
      return { status: mode.execute.result, receipt: mode.execute };
    },
    async reconcileClaimed() {
      calls.reconcile += 1;
      return { status: mode.reconcile.result, receipt: mode.reconcile };
    },
  };
}

describe("FATES-007A Horae durable claim boundary", () => {
  it("persists full authority material, claims once, and reaches CONFIRMED", async () => {
    const input = authority();
    const calls = { execute: 0, reconcile: 0 };
    const store = new FileFates007aExecutionStore({ filePath: statePath() });
    const coordinator = new Fates007aExecutionCoordinator(
      store,
      binding(
        { execute: receiptFor(input, "CONFIRMED"), reconcile: receiptFor(input, "CONFIRMED") },
        calls,
      ),
      () => NOW,
    );
    const result = await coordinator.execute({
      authority: input,
      args: { recipient: "recipient-1", value: "bounded-value" },
      owner: "pid:test:one",
      now: NOW,
    });
    expect(result.state).toBe("terminal");
    expect(result.result).toBe("CONFIRMED");
    expect(result.nativeActionHash).toBe(input.nativeActionHash);
    expect(result.authority).toEqual(input);
    expect(calls).toEqual({ execute: 1, reconcile: 0 });
    expect(
      new FileFates007aExecutionStore({ filePath: storePath(store) }).get(input.durableExecutionId),
    ).toMatchObject({ state: "terminal", result: "CONFIRMED" });
  });

  it("keeps the effect UNKNOWN after provider success but missing receipt, then reconciles without redispatch", async () => {
    const input = authority();
    const calls = { execute: 0, reconcile: 0 };
    const store = new FileFates007aExecutionStore({ filePath: statePath() });
    const coordinator = new Fates007aExecutionCoordinator(
      store,
      binding(
        { execute: receiptFor(input, "UNKNOWN"), reconcile: receiptFor(input, "CONFIRMED") },
        calls,
      ),
      () => NOW,
    );
    const uncertain = await coordinator.execute({
      authority: input,
      args: {},
      owner: "pid:test:one",
      now: NOW,
    });
    expect(uncertain).toMatchObject({ state: "effect_reconciliation_required", result: "UNKNOWN" });
    const recovered = await coordinator.recover({
      durableExecutionId: input.durableExecutionId,
      args: {},
      owner: "pid:test:recovery",
      now: LATER,
    });
    expect(recovered).toMatchObject({ state: "terminal", result: "CONFIRMED" });
    expect(calls).toEqual({ execute: 1, reconcile: 1 });
  });

  it("requires explicit fresh authority after ABSENT and never retries the old terminal intent", async () => {
    const first = authority();
    const calls = { execute: 0, reconcile: 0 };
    const firstStore = new FileFates007aExecutionStore({ filePath: statePath() });
    const firstCoordinator = new Fates007aExecutionCoordinator(
      firstStore,
      binding(
        { execute: receiptFor(first, "UNKNOWN"), reconcile: receiptFor(first, "ABSENT") },
        calls,
      ),
      () => NOW,
    );
    expect(
      (
        await firstCoordinator.execute({
          authority: first,
          args: {},
          owner: "pid:test:one",
          now: NOW,
        })
      ).result,
    ).toBe("UNKNOWN");
    expect(
      (
        await firstCoordinator.recover({
          durableExecutionId: first.durableExecutionId,
          args: {},
          owner: "pid:test:recovery",
          now: LATER,
        })
      ).result,
    ).toBe("ABSENT");
    expect(
      (
        await firstCoordinator.recover({
          durableExecutionId: first.durableExecutionId,
          args: {},
          owner: "pid:test:again",
          now: LATER,
        })
      ).result,
    ).toBe("ABSENT");
    const fresh = authority({
      requestIdentity: {
        ...CONTEXT.correlation,
        requestId: "request-007a-fresh",
        correlationId: "correlation-007a-fresh",
      },
      authenticatedContext: {
        ...CONTEXT,
        correlation: {
          ...CONTEXT.correlation,
          requestId: "request-007a-fresh",
          correlationId: "correlation-007a-fresh",
        },
      },
    });
    expect(fresh.durableExecutionId).not.toBe(first.durableExecutionId);
    const freshCoordinator = new Fates007aExecutionCoordinator(
      firstStore,
      binding(
        { execute: receiptFor(fresh, "CONFIRMED"), reconcile: receiptFor(fresh, "CONFIRMED") },
        calls,
      ),
      () => NOW,
    );
    expect(
      (
        await freshCoordinator.execute({
          authority: fresh,
          args: {},
          owner: "pid:test:fresh",
          now: NOW,
        })
      ).result,
    ).toBe("CONFIRMED");
    expect(calls.execute).toBe(2);
  });

  it("arbitrates simultaneous claims and rejects stale, copied, and mismatched claim material", () => {
    const input = authority();
    const path = statePath();
    const store = new FileFates007aExecutionStore({ filePath: path });
    const otherStore = new FileFates007aExecutionStore({ filePath: path });
    store.createExecutionIntent(input, NOW);
    const [left, right] = [
      store.claimDispatch(input.durableExecutionId, "pid:test:left", NOW),
      otherStore.claimDispatch(input.durableExecutionId, "pid:test:right", NOW),
    ];
    expect([left.acquired, right.acquired].sort()).toEqual([false, true]);
    const winner = left.acquired ? left : right;
    if (!winner.acquired) throw new Error("claim winner missing");
    expect(
      store.verifyClaim(input, {
        ...winner.claim,
        owner: "pid:test:stale",
        claimDigest: winner.claim.claimDigest,
      }),
    ).toMatchObject({ valid: false });
    expect(
      store.verifyClaim(input, {
        ...winner.claim,
        durableExecutionId: "fates-execution:sha256:" + "f".repeat(64),
      }),
    ).toMatchObject({ valid: false });
    expect(store.verifyClaim(input, { ...winner.claim, generation: 2 })).toMatchObject({
      valid: false,
    });
    const copied = authority({
      requestIdentity: {
        ...CONTEXT.correlation,
        requestId: "request-copy",
        correlationId: "correlation-copy",
      },
      authenticatedContext: {
        ...CONTEXT,
        correlation: {
          ...CONTEXT.correlation,
          requestId: "request-copy",
          correlationId: "correlation-copy",
        },
      },
    });
    expect(store.verifyClaim(copied, winner.claim)).toMatchObject({ valid: false });
  });

  it("keeps renewed approval on the same unclaimed durable effect identity", () => {
    const input = authority();
    const renewed = authority({
      approval: {
        ...APPROVAL_A,
        grantId: "grant-renewed",
        approvalActionHash: "1".repeat(64),
        expiresAt: "2026-09-03T10:10:00.000Z",
      },
    });
    expect(renewed.durableExecutionId).toBe(input.durableExecutionId);
    expect(renewed.authorityInstanceDigest).not.toBe(input.authorityInstanceDigest);
    const store = new FileFates007aExecutionStore({ filePath: statePath() });
    expect(store.createExecutionIntent(input, NOW).created).toBe(true);
    expect(store.createExecutionIntent(renewed, NOW).created).toBe(false);
    expect(store.get(input.durableExecutionId)?.authority).toEqual(renewed);
  });

  it("fails closed on missing, truncated, and checksum-corrupt persistence", () => {
    const path = statePath();
    const store = new FileFates007aExecutionStore({ filePath: path });
    expect(store.get("missing")).toBeUndefined();
    writeFileSync(path, "not-json", "utf8");
    expect(() => store.get("missing")).toThrow(/unreadable/);
    writeFileSync(
      path,
      JSON.stringify({ schemaVersion: 1, records: [], checksum: "sha256:" + "0".repeat(64) }),
      "utf8",
    );
    expect(() => store.get("missing")).toThrow(/checksum/);
    writeFileSync(path, "{", "utf8");
    expect(() => store.get("missing")).toThrow(/unreadable/);
  });

  it("records execution_reserved versus invocation_started so recovery never blind-retries an started effect", async () => {
    const input = authority();
    const store = new FileFates007aExecutionStore({ filePath: statePath() });
    store.createExecutionIntent(input, NOW);
    const claimed = store.claimDispatch(input.durableExecutionId, "pid:test:owner", NOW);
    if (!claimed.acquired) throw new Error("claim was not acquired");
    expect(store.reserveExecution(input, claimed.claim, NOW)).toMatchObject({
      valid: true,
      state: "execution_reserved",
    });
    const recovered = store.recoverClaim(input.durableExecutionId, "pid:test:recovery", LATER);
    expect(recovered).toMatchObject({ acquired: true, claim: { generation: 2 } });
    if (!recovered.acquired) throw new Error("recovery claim was not acquired");
    expect(store.markInvocationStarted(input, recovered.claim, LATER)).toMatchObject({
      valid: true,
      state: "executor_invocation_started",
    });
    const calls = { execute: 0, reconcile: 0 };
    const coordinator = new Fates007aExecutionCoordinator(
      store,
      binding(
        { execute: receiptFor(input, "CONFIRMED"), reconcile: receiptFor(input, "CONFIRMED") },
        calls,
      ),
      () => LATER,
    );
    expect(
      (
        await coordinator.recover({
          durableExecutionId: input.durableExecutionId,
          args: {},
          owner: "pid:test:second-recovery",
          now: LATER,
        })
      ).state,
    ).toBe("terminal");
    expect(calls).toEqual({ execute: 0, reconcile: 1 });
  });

  it("uses deterministic crash points for admission-to-claim and claim-to-Ananke recovery", async () => {
    const input = authority();
    const calls = { execute: 0, reconcile: 0 };
    const path = statePath();
    const store = new FileFates007aExecutionStore({ filePath: path });
    let crash = true;
    const coordinator = new Fates007aExecutionCoordinator(
      store,
      binding(
        { execute: receiptFor(input, "CONFIRMED"), reconcile: receiptFor(input, "CONFIRMED") },
        calls,
      ),
      () => NOW,
      (point) => {
        if (crash && point === "after_intent_before_claim")
          throw new Error("synthetic crash before claim");
      },
    );
    await expect(
      coordinator.execute({ authority: input, args: {}, owner: "pid:test:one", now: NOW }),
    ).rejects.toThrow(/before claim/);
    expect(store.get(input.durableExecutionId)).toMatchObject({ state: "authority_validated" });
    crash = false;
    expect(
      (await coordinator.execute({ authority: input, args: {}, owner: "pid:test:one", now: NOW }))
        .result,
    ).toBe("CONFIRMED");

    const secondInput = authority({
      requestIdentity: {
        ...CONTEXT.correlation,
        requestId: "request-crash-2",
        correlationId: "correlation-crash-2",
      },
      authenticatedContext: {
        ...CONTEXT,
        correlation: {
          ...CONTEXT.correlation,
          requestId: "request-crash-2",
          correlationId: "correlation-crash-2",
        },
      },
    });
    const secondPath = statePath();
    const secondStore = new FileFates007aExecutionStore({ filePath: secondPath });
    let crashAfterClaim = true;
    const secondCoordinator = new Fates007aExecutionCoordinator(
      secondStore,
      binding(
        {
          execute: receiptFor(secondInput, "CONFIRMED"),
          reconcile: receiptFor(secondInput, "CONFIRMED"),
        },
        calls,
      ),
      () => NOW,
      (point) => {
        if (crashAfterClaim && point === "after_claim_before_ananke")
          throw new Error("synthetic crash before Ananke");
      },
    );
    await expect(
      secondCoordinator.execute({
        authority: secondInput,
        args: {},
        owner: "pid:test:one",
        now: NOW,
      }),
    ).rejects.toThrow(/before Ananke/);
    expect(secondStore.get(secondInput.durableExecutionId)).toMatchObject({
      state: "authority_validated",
      claim: { generation: 1, owner: "pid:test:one" },
    });
    crashAfterClaim = false;
    expect(
      (
        await secondCoordinator.recover({
          durableExecutionId: secondInput.durableExecutionId,
          args: {},
          owner: "pid:test:recovery",
          now: LATER,
        })
      ).result,
    ).toBe("CONFIRMED");
    expect(calls.execute).toBe(2);
  });
});

function storePath(store: FileFates007aExecutionStore): string {
  return (store as unknown as { filePath: string }).filePath;
}
