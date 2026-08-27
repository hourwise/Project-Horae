import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FileDurableExecutionStateStore, GovernedExecutionCoordinator } from "../dist/index.js";

const [statePath, callLogPath, barrierPath, childId] = process.argv.slice(2);
const profile = {
  id: "process-race-profile",
  projectId: "process-race-project",
  requiredRuntimeCapabilities: [],
  allowedRuntimeCapabilities: [],
  auditDestinations: [],
  capabilityExposure: "fixed",
};
const request = {
  idempotencyKey: "process-race-key",
  sessionRequest: {
    projectId: "process-race-project",
    profileId: profile.id,
    task: "process race",
    purpose: "governed.memory-admission",
    execution: {
      authenticatedPrincipal: { id: "process-race-service", kind: "service" },
      actingPrincipal: { id: "process-race-agent", kind: "agent" },
      projectId: profile.projectId,
      tenantId: "process-race-tenant",
      workspaceId: "process-race-workspace",
      runtimeId: "process-race-runtime",
      sessionId: "process-race-session",
    },
    scope: { mode: "bounded", projectId: profile.projectId, tenantId: "process-race-tenant", workspaceId: "process-race-workspace", resourceIds: ["process-race-source"] },
    correlation: { requestId: "process-race-request", correlationId: "process-race-correlation" },
    requiredCapabilities: [],
  },
  profile,
  source: { sourceId: "process-race-source" },
  content: "process race content",
  contentAccess: { destination: "controlled-effect" },
  memoryId: "process-race-memory",
};
const orchestrator = {
  start(input) {
    return {
      id: `session-${input.correlation.requestId}`,
      composition: { id: `composition-${input.correlation.requestId}` },
      request: input,
      profile,
      capabilityPlan: { visible: [], hidden: [], requiredRuntimeIds: [], optionalRuntimeIds: [] },
      runtimeIds: [],
      startedAt: "2026-08-27T12:00:00.000Z",
    };
  },
};

mkdirSync(barrierPath, { recursive: true });
writeFileSync(join(barrierPath, `${childId}.ready`), "ready", "utf8");
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const deadline = Date.now() + 10_000;
while (!existsSync(join(barrierPath, "a.ready")) || !existsSync(join(barrierPath, "b.ready"))) {
  if (Date.now() >= deadline) throw new Error("process race barrier timed out");
  Atomics.wait(sleeper, 0, 0, 5);
}

const coordinator = new GovernedExecutionCoordinator({
  orchestrator,
  ananke: { preflight: async () => ({ action: "ALLOW", receipt: { receiptId: "process-race-receipt" } }) },
  mnemosyne: { admit: async () => ({ state: "ADMITTED", admissionId: "process-race-admission", memoryId: request.memoryId }) },
  executor: {
    run: async ({ effectId }) => {
      appendFileSync(callLogPath, `${childId}:${effectId}\n`, "utf8");
      return { effectId, childId };
    },
  },
  stateStore: new FileDurableExecutionStateStore({ filePath: statePath }),
  now: () => "2026-08-27T12:00:00.000Z",
});

try {
  const result = await coordinator.execute(request);
  writeFileSync(join(barrierPath, `${childId}.result.json`), JSON.stringify({ state: result.state, effectId: result.effectId }), "utf8");
} catch (error) {
  writeFileSync(join(barrierPath, `${childId}.result.json`), JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), "utf8");
  process.exitCode = 1;
}
