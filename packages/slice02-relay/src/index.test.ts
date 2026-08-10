import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import {
  parseCompatibilityManifest,
  parseRuntimeHealth,
  parseRuntimeIdentity,
  parseRuntimeReadiness,
  parseRuntimeRegistration,
} from "@horae/adrasteia-adapter";
import type { PeerInspection } from "@horae/schema";
import {
  SLICE02_ACTION,
  SLICE02_ANANKE_PRODUCER,
  SLICE02_FIXTURE_ID,
  SLICE02_FIXTURE_SHA256,
  SLICE02_REQUEST_SCHEMA_ID,
  SLICE02_REQUEST_SCHEMA_SHA256,
  SLICE02_R1_REQUEST_SCHEMA_ID,
  SLICE02_R1_REQUEST_SCHEMA_SHA256,
  HttpSlice02AnankeBinding,
  Slice02Relay,
  DurableSlice02ReplayLedger,
  type Slice02AnankeBinding,
  type Slice02DispatchInput,
  type Slice02DispatchResult,
  type Slice02RequestMetadata,
  type Slice02ToolMetadata,
  slice02OriginDigest,
  slice02R1Audience,
  slice02R1OriginDigest,
} from "./index.js";

const NOW = Date.parse("2026-08-09T16:00:00.000Z");
const ENDPOINT = "http://ananke.test/api";
const INSTANCE_ID = "ananke-instance-1";
const TEST_ANANKE_TOKEN = randomBytes(32).toString("hex");
const R1_AUDIENCE = slice02R1Audience("horae-r1-test");

const ACTION: Slice02ToolMetadata = {
  name: SLICE02_ACTION,
  server: "ananke.slice02",
  riskClass: "READ_ONLY",
  retryable: false,
  requiresApproval: false,
  inputSchema: {
    additionalProperties: false,
    properties: {
      fixtureId: { const: SLICE02_FIXTURE_ID, type: "string" },
      expectedSha256: { pattern: "^[0-9a-f]{64}$", type: "string" },
    },
    required: ["fixtureId", "expectedSha256"],
    type: "object",
  },
};

function inspection(
  overrides: {
    ready?: boolean;
    healthy?: boolean;
    checkedAt?: string;
    endpoint?: string;
    instanceId?: string;
    protocolVersion?: string;
    minimumProtocolVersion?: string;
    action?: Slice02ToolMetadata;
  } = {},
): PeerInspection {
  const protocolVersion = overrides.protocolVersion ?? "1.4.0";
  const minimumProtocolVersion = overrides.minimumProtocolVersion ?? "1.0.0";
  const checkedAt = overrides.checkedAt ?? new Date(NOW).toISOString();
  const identity = parseRuntimeIdentity({
    runtime: "ananke",
    kind: "ananke",
    displayName: "Ananke Outcome Gateway",
    version: "0.1.0",
    packageVersion: "0.1.0",
    protocolVersion,
    minimumProtocolVersion,
    supportedProtocolRange: { minimum: minimumProtocolVersion, maximum: protocolVersion },
    instanceId: overrides.instanceId ?? INSTANCE_ID,
    standalone: true,
    capabilities: [],
    metadata: {
      repositoryUrl: SLICE02_ANANKE_PRODUCER.repository,
      annotations: {
        runtimeContracts: "project-runtime-contracts@0.4.0",
        "fates.slice02.producerRepository": SLICE02_ANANKE_PRODUCER.repository,
        "fates.slice02.producerCheckpoint": SLICE02_ANANKE_PRODUCER.checkpoint,
        "fates.slice02.producerTag": SLICE02_ANANKE_PRODUCER.tag,
        "fates.slice02.implementationCommit": SLICE02_ANANKE_PRODUCER.implementationCommit,
      },
    },
  });
  const healthy = overrides.healthy ?? true;
  const ready = overrides.ready ?? true;
  const health = parseRuntimeHealth({
    healthy,
    status: healthy ? "healthy" : "degraded",
    uptimeMs: 100,
    warnings: [],
    checkedAt,
  });
  const readiness = parseRuntimeReadiness({
    ready,
    status: ready ? "ready" : "not_ready",
    checkedAt,
    dependencies: [
      {
        dependencyId: "runtime-initialisation",
        status: ready ? "ready" : "not_ready",
        required: true,
      },
      {
        dependencyId: "registered-tool-executors",
        status: ready ? "ready" : "not_ready",
        required: true,
      },
    ],
  });
  const registration = parseRuntimeRegistration({
    identity,
    capabilities: [],
    health,
    readiness,
    endpoints: [{ id: "gateway-http", transport: "http", url: overrides.endpoint ?? ENDPOINT }],
    registeredAt: checkedAt,
    inspectionMechanism: "public HTTP runtime inspection endpoints",
    standalone: true,
  });
  const compatibility = parseCompatibilityManifest({
    manifestSchemaVersion: "1.0.0",
    runtimeName: "ananke",
    runtimeVersion: "0.1.0",
    packageVersion: "project-runtime-contracts@0.4.0",
    protocolVersion,
    minimumSupportedProtocolVersion: minimumProtocolVersion,
    supportedProtocolRange: { minimum: minimumProtocolVersion, maximum: protocolVersion },
    requiredRuntimeContractsVersionRange: "0.4.0",
    supportedTransports: ["http", "local"],
    capabilities: [],
    standalone: true,
    knownConstraints: ["Slice 02 owner-local test inspection"],
  });
  return {
    identity,
    health,
    readiness,
    registration,
    compatibility,
    inspectionMechanism: "Ananke public HTTP runtime inspection endpoints",
  };
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const originId = "moirae-origin-slice02-1";
  return {
    action: SLICE02_ACTION,
    arguments: { fixtureId: SLICE02_FIXTURE_ID, expectedSha256: SLICE02_FIXTURE_SHA256 },
    origin: {
      runtime: "moirae-code",
      instanceId: "moirae-instance-1",
      artifact: "moirae-slice02-host-checkpoint",
      receipt: {
        originId,
        originDigest: slice02OriginDigest(originId),
        schemaId: SLICE02_REQUEST_SCHEMA_ID,
        schemaSha256: SLICE02_REQUEST_SCHEMA_SHA256,
        validity: {
          notBefore: "2026-01-01T00:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      },
    },
    execution: {
      authenticatedPrincipal: { id: "moirae-host", kind: "service", tenantId: "tenant-1" },
      actingPrincipal: { id: "moirae-agent", kind: "agent", tenantId: "tenant-1" },
      runtimeId: "moirae-code",
      runtimeInstanceId: "moirae-instance-1",
      tenantId: "tenant-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
    },
    scope: {
      mode: "bounded",
      tenantId: "tenant-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      resourceType: "fixed-fixture",
      resourceIds: [SLICE02_FIXTURE_ID],
      operations: ["read"],
    },
    purpose: "slice02.fixed-fixture-inspection",
    correlation: { requestId: "request-1", correlationId: "correlation-1" },
    ...overrides,
  };
}

function r1Request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const originId = "moirae-r1-origin-slice02-1";
  const validity = {
    notBefore: "2026-08-09T15:59:30.000Z",
    expiresAt: "2026-08-09T16:00:30.000Z",
  };
  return r1RequestWithIdentity({ originId, audience: R1_AUDIENCE, validity, overrides });
}

function r1RequestWithIdentity(input: {
  originId: string;
  audience: string;
  validity: { notBefore: string; expiresAt: string };
  overrides?: Record<string, unknown>;
}): Record<string, unknown> {
  return request({
    ...input.overrides,
    origin: {
      runtime: "moirae-code",
      instanceId: "moirae-instance-1",
      artifact: "moirae-slice02-r1-host",
      receipt: {
        originId: input.originId,
        originDigest: slice02R1OriginDigest(input),
        schemaId: SLICE02_R1_REQUEST_SCHEMA_ID,
        schemaSha256: SLICE02_R1_REQUEST_SCHEMA_SHA256,
        audience: input.audience,
        validity: input.validity,
      },
    },
  });
}

class MockBinding implements Slice02AnankeBinding {
  inspectCalls = 0;
  actionCalls = 0;
  dispatchCalls = 0;
  lastDispatch?: Slice02DispatchInput;
  result: Slice02DispatchResult | Promise<Slice02DispatchResult> = {
    kind: "response",
    payload: {
      outcome: { state: "COMPLETED", data: "opaque producer data", retryable: false },
      evidence: {
        requestId: "ananke-request-1",
        decisionId: "ananke-decision-1",
        outcomeId: "ananke-outcome-1",
        auditId: "ananke-audit-1",
        readAttemptCount: 1,
      },
    },
  };
  currentInspection = inspection();
  currentAction = ACTION;

  inspect(): Promise<PeerInspection> {
    this.inspectCalls += 1;
    return Promise.resolve(this.currentInspection);
  }

  inspectAction(): Promise<Slice02ToolMetadata> {
    this.actionCalls += 1;
    return Promise.resolve(this.currentAction);
  }

  dispatch(input: Slice02DispatchInput): Promise<Slice02DispatchResult> {
    this.dispatchCalls += 1;
    this.lastDispatch = input;
    return Promise.resolve(this.result);
  }
}

function relay(binding: MockBinding, now = NOW, inspectionTimeoutMs = 1_000): Slice02Relay {
  return new Slice02Relay({
    binding,
    expectedOrigin: {
      runtime: "moirae-code",
      instanceId: "moirae-instance-1",
      artifact: "moirae-slice02-host-checkpoint",
    },
    expectedAnanke: { instanceId: INSTANCE_ID, endpoint: ENDPOINT },
    authorizationHeader: `Bearer ${TEST_ANANKE_TOKEN}`,
    now: () => now,
    inspectionTimeoutMs,
  });
}

async function call(
  relayInstance: Slice02Relay,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await relayInstance.handle(
    new Request("http://horae.test/slice-02/governed-actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("Horae Slice 02 bounded relay", () => {
  it("uses Ananke's canonical HTTP execute endpoint with one exact handoff", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ outcome: { state: "COMPLETED" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const binding = new HttpSlice02AnankeBinding(ENDPOINT, fakeFetch);
    const source = request();
    const metadata = (source.origin as { receipt: Slice02RequestMetadata }).receipt;
    const dispatchInput: Slice02DispatchInput = {
      arguments: { fixtureId: SLICE02_FIXTURE_ID, expectedSha256: SLICE02_FIXTURE_SHA256 },
      purpose: "slice02.fixed-fixture-inspection",
      correlation: { requestId: "request-1", correlationId: "correlation-1" },
      adapterMetadata: metadata,
      authorizationHeader: `Bearer ${TEST_ANANKE_TOKEN}`,
      timeoutMs: 1_000,
    };

    await expect(binding.dispatch(dispatchInput)).resolves.toMatchObject({ kind: "response" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${ENDPOINT}/api/execute`);
    expect(calls[0].init?.headers).toMatchObject({
      authorization: `Bearer ${TEST_ANANKE_TOKEN}`,
      "x-ananke-correlation-id": "correlation-1",
    });
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      toolName: SLICE02_ACTION,
      arguments: dispatchInput.arguments,
      purpose: dispatchInput.purpose,
      adapterMetadata: metadata,
    });
  });

  it("reinspects, reduces the exact action, dispatches once, and relays typed completion", async () => {
    const binding = new MockBinding();
    const result = await call(relay(binding), request());

    expect(result.status).toBe(200);
    expect(result.body.state).toBe("completed");
    expect(binding.inspectCalls).toBe(1);
    expect(binding.actionCalls).toBe(1);
    expect(binding.dispatchCalls).toBe(1);
    expect(binding.lastDispatch).toMatchObject({
      arguments: { fixtureId: SLICE02_FIXTURE_ID, expectedSha256: SLICE02_FIXTURE_SHA256 },
      purpose: "slice02.fixed-fixture-inspection",
      authorizationHeader: `Bearer ${TEST_ANANKE_TOKEN}`,
      adapterMetadata: { schemaId: SLICE02_REQUEST_SCHEMA_ID },
    });
    expect(result.body.routeId).not.toBe(result.body.eventId);
    expect(result.body.correlation).toEqual({
      requestId: "request-1",
      correlationId: "correlation-1",
    });
    expect((result.body.ananke as Record<string, unknown>).evidence).toMatchObject({
      decisionId: "ananke-decision-1",
      outcomeId: "ananke-outcome-1",
      auditId: "ananke-audit-1",
    });
  });

  it("preserves a denied Ananke result without rewriting producer evidence", async () => {
    const binding = new MockBinding();
    binding.result = {
      kind: "response",
      payload: {
        outcome: { state: "DENIED", reasonCode: "POLICY_DENIED" },
        evidence: { decisionId: "denied-decision", readAttemptCount: 0 },
      },
    };
    const result = await call(relay(binding), request());

    expect(result.body.state).toBe("denied");
    expect(result.body.dispatchState).toBe("result_received");
    expect((result.body.ananke as Record<string, unknown>).outcome).toEqual({
      state: "DENIED",
      reasonCode: "POLICY_DENIED",
    });
    expect(result.body.producerEvidence).toEqual({
      decisionId: "denied-decision",
      readAttemptCount: 0,
    });
  });

  it("projects only the canonical Ananke result fields and strips forged or inherited fields", async () => {
    const binding = new MockBinding();
    const evidence = Object.create({ inheritedEvidence: "drop" }) as Record<string, unknown>;
    evidence.readAttemptCount = 1;
    evidence.nested = { allowedEvidence: true };
    const outcome = Object.create({ inheritedOutcome: "drop" }) as Record<string, unknown>;
    outcome.state = "COMPLETED";
    outcome.retryable = false;
    outcome.data = { nested: { allowedData: true } };
    outcome.forgedReplacement = "drop";
    binding.result = {
      kind: "response",
      payload: {
        outcome,
        evidence,
        approvalRequired: false,
        approvalGrantId: "grant-1",
        unexpectedTopLevel: "drop",
      },
    };

    const result = await call(relay(binding), request());
    const ananke = result.body.ananke as Record<string, unknown>;

    expect(ananke).toEqual({
      outcome: {
        state: "COMPLETED",
        retryable: false,
        data: { nested: { allowedData: true } },
      },
      evidence: {
        readAttemptCount: 1,
        nested: { allowedEvidence: true },
      },
      approvalRequired: false,
      approvalGrantId: "grant-1",
    });
    expect("unexpectedTopLevel" in ananke).toBe(false);
    expect("forgedReplacement" in (ananke.outcome as Record<string, unknown>)).toBe(false);
    expect("inheritedEvidence" in (ananke.evidence as Record<string, unknown>)).toBe(false);
    expect("inheritedOutcome" in (ananke.outcome as Record<string, unknown>)).toBe(false);
  });

  it("treats malformed canonical result data as indeterminate after dispatch", async () => {
    const binding = new MockBinding();
    binding.result = {
      kind: "response",
      payload: { outcome: { state: "COMPLETED" }, evidence: [] },
    };

    const result = await call(relay(binding), request());

    expect(result.body.state).toBe("indeterminate");
    expect(result.body.dispatchState).toBe("result_lost_indeterminate");
  });

  it("rejects malformed or mutated origin/arguments before inspection and dispatch", async () => {
    const binding = new MockBinding();
    const malformed = await call(relay(binding), {
      ...request(),
      arguments: {
        fixtureId: SLICE02_FIXTURE_ID,
        expectedSha256: SLICE02_FIXTURE_SHA256,
        extra: true,
      },
    });
    const mutatedOrigin = await call(relay(binding), {
      ...request(),
      origin: { ...(request().origin as Record<string, unknown>), instanceId: "other" },
    });

    expect(malformed.status).toBe(400);
    expect(mutatedOrigin.status).toBe(400);
    expect(binding.inspectCalls).toBe(0);
    expect(binding.dispatchCalls).toBe(0);
  });

  it("refuses stale readiness, not-ready startup, protocol, endpoint, instance, and action drift", async () => {
    const staleBinding = new MockBinding();
    staleBinding.currentInspection = inspection({ checkedAt: "2026-08-09T15:59:58.900Z" });
    const stale = await call(relay(staleBinding), request());
    expect(stale.body.state).toBe("stale");
    expect(staleBinding.dispatchCalls).toBe(0);

    const startupBinding = new MockBinding();
    startupBinding.currentInspection = inspection({ ready: false });
    const startup = await call(relay(startupBinding), request());
    expect(startup.body.state).toBe("unavailable");
    expect(startupBinding.dispatchCalls).toBe(0);

    const protocolBinding = new MockBinding();
    protocolBinding.currentInspection = inspection({
      protocolVersion: "2.0.0",
      minimumProtocolVersion: "2.0.0",
    });
    const protocol = await call(relay(protocolBinding), request());
    expect(protocol.body.state).toBe("incompatible");
    expect(protocolBinding.dispatchCalls).toBe(0);

    const driftBinding = new MockBinding();
    driftBinding.currentInspection = inspection({
      endpoint: "http://other.test/api",
      instanceId: "other-instance",
    });
    const drift = await call(relay(driftBinding), request());
    expect(drift.body.state).toBe("incompatible");
    expect(driftBinding.dispatchCalls).toBe(0);

    const actionBinding = new MockBinding();
    actionBinding.currentAction = { ...ACTION, name: "other.action" };
    const action = await call(relay(actionBinding), request());
    expect(action.body.state).toBe("incompatible");
    expect(actionBinding.dispatchCalls).toBe(0);
  });

  it("makes timeout and post-dispatch transport loss non-success and never retries", async () => {
    const timeoutBinding = new MockBinding();
    timeoutBinding.result = { kind: "timeout" };
    const timeout = await call(relay(timeoutBinding), request());
    expect(timeout.body.state).toBe("timed_out");
    expect(timeout.body.dispatchState).toBe("timed_out_after_dispatch");
    expect(timeoutBinding.dispatchCalls).toBe(1);

    const lossBinding = new MockBinding();
    lossBinding.result = { kind: "transport" };
    const loss = await call(relay(lossBinding), request());
    expect(loss.body.state).toBe("indeterminate");
    expect(loss.body.dispatchState).toBe("result_lost_indeterminate");
    expect(lossBinding.dispatchCalls).toBe(1);
  });

  it("bounds a local HTTP inspection that never resolves and never dispatches or retries", async () => {
    let requests = 0;
    const server = createServer(() => {
      requests += 1;
    });
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("inspection test server has no address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const httpBinding = new HttpSlice02AnankeBinding(baseUrl);
    let dispatchCalls = 0;
    const binding: Slice02AnankeBinding = {
      inspect: (signal) => httpBinding.inspect(signal),
      inspectAction: (signal) => httpBinding.inspectAction(signal),
      dispatch: (input) => {
        dispatchCalls += 1;
        return httpBinding.dispatch(input);
      },
    };
    const instance = new Slice02Relay({
      binding,
      expectedOrigin: {
        runtime: "moirae-code",
        instanceId: "moirae-instance-1",
        artifact: "moirae-slice02-host-checkpoint",
      },
      expectedAnanke: { instanceId: INSTANCE_ID, endpoint: `${baseUrl}/api` },
      inspectionTimeoutMs: 50,
      now: () => NOW,
    });
    const startedAt = Date.now();

    try {
      const result = await call(instance, request());
      expect(Date.now() - startedAt).toBeLessThan(500);
      expect(result.status).toBe(504);
      expect(result.body.state).toBe("timed_out");
      expect(result.body.dispatchState).toBe("dispatch_not_attempted");
      expect(dispatchCalls).toBe(0);
      expect(requests).toBeLessThanOrEqual(5);
    } finally {
      server.closeAllConnections();
      await close(server);
    }
  });

  it("bounds a local HTTP action inspection that never resolves after healthy peer inspection", async () => {
    const responses: Record<string, unknown> = {};
    const server = createServer((incoming, outgoing) => {
      const payload = responses[incoming.url ?? ""];
      if (payload === undefined) return;
      outgoing.writeHead(200, { "content-type": "application/json" });
      outgoing.end(JSON.stringify(payload));
    });
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("action test server has no address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const snapshot = inspection({ endpoint: `${baseUrl}/api` });
    Object.assign(responses, {
      "/api/runtime/identity": snapshot.identity,
      "/api/runtime/health": snapshot.health,
      "/api/runtime/readiness": snapshot.readiness,
      "/api/runtime/registration": snapshot.registration,
      "/api/runtime/compatibility": snapshot.compatibility,
    });
    const httpBinding = new HttpSlice02AnankeBinding(baseUrl);
    let dispatchCalls = 0;
    const binding: Slice02AnankeBinding = {
      inspect: (signal) => httpBinding.inspect(signal),
      inspectAction: (signal) => httpBinding.inspectAction(signal),
      dispatch: (input) => {
        dispatchCalls += 1;
        return httpBinding.dispatch(input);
      },
    };
    const instance = new Slice02Relay({
      binding,
      expectedOrigin: {
        runtime: "moirae-code",
        instanceId: "moirae-instance-1",
        artifact: "moirae-slice02-host-checkpoint",
      },
      expectedAnanke: { instanceId: INSTANCE_ID, endpoint: `${baseUrl}/api` },
      inspectionTimeoutMs: 50,
      now: () => NOW,
    });

    try {
      const result = await call(instance, request());
      expect(result.body.state).toBe("timed_out");
      expect(result.body.dispatchState).toBe("dispatch_not_attempted");
      expect(dispatchCalls).toBe(0);
    } finally {
      server.closeAllConnections();
      await close(server);
    }
  });

  it("does not continue after a late completion of an aborted inspection", async () => {
    let actionCalls = 0;
    let dispatchCalls = 0;
    const binding: Slice02AnankeBinding = {
      inspect: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(inspection()), 75);
        }),
      inspectAction: () => {
        actionCalls += 1;
        return Promise.resolve(ACTION);
      },
      dispatch: () => {
        dispatchCalls += 1;
        return Promise.resolve({ kind: "response", payload: { outcome: { state: "COMPLETED" } } });
      },
    };
    const instance = new Slice02Relay({
      binding,
      expectedOrigin: {
        runtime: "moirae-code",
        instanceId: "moirae-instance-1",
        artifact: "moirae-slice02-host-checkpoint",
      },
      expectedAnanke: { instanceId: INSTANCE_ID, endpoint: ENDPOINT },
      inspectionTimeoutMs: 20,
      now: () => NOW,
    });

    const result = await call(instance, request());
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(result.body.state).toBe("timed_out");
    expect(result.body.dispatchState).toBe("dispatch_not_attempted");
    expect(actionCalls).toBe(0);
    expect(dispatchCalls).toBe(0);
  });

  it("keeps host-owned Ananke authentication separate from caller headers", async () => {
    const binding = new MockBinding();
    const instance = relay(binding);
    const response = await instance.handle(
      new Request("http://horae.test/slice-02/governed-actions", {
        method: "POST",
        headers: {
          authorization: "Bearer caller-supplied-override",
          "content-type": "application/json",
        },
        body: JSON.stringify(request()),
      }),
    );
    const body = await response.text();

    expect(binding.lastDispatch?.authorizationHeader).toBe(`Bearer ${TEST_ANANKE_TOKEN}`);
    expect(body).not.toContain(TEST_ANANKE_TOKEN);
    expect(body).not.toContain("caller-supplied-override");
  });

  it("accepts a current R1 identity once and preserves Ananke denial as authority", async () => {
    const ledgerDirectory = mkdtempSync(join(tmpdir(), "fates-r1-ledger-"));
    try {
      const binding = new MockBinding();
      binding.result = {
        kind: "response",
        payload: { outcome: { state: "DENIED", reasonCode: "PERMISSION_DENIED" } },
      };
      const instance = new Slice02Relay({
        binding,
        expectedOrigin: {
          runtime: "moirae-code",
          instanceId: "moirae-instance-1",
          artifact: "moirae-slice02-r1-host",
        },
        expectedAnanke: { instanceId: INSTANCE_ID, endpoint: ENDPOINT },
        authorizationHeader: `Bearer ${TEST_ANANKE_TOKEN}`,
        requestIdentity: {
          version: "r1-v2",
          audience: R1_AUDIENCE,
          replayLedger: new DurableSlice02ReplayLedger(join(ledgerDirectory, "consumed.json")),
        },
        now: () => NOW,
      });

      const result = await call(instance, r1Request());

      expect(result.body.state).toBe("denied");
      expect(result.body.dispatchState).toBe("result_received");
      expect(binding.dispatchCalls).toBe(1);
      expect(result.body.reason).toBeUndefined();
    } finally {
      rmSync(ledgerDirectory, { recursive: true, force: true });
    }
  });

  it("rejects expired, wrong-audience, malformed, and exact replay identities before dispatch", async () => {
    const ledgerDirectory = mkdtempSync(join(tmpdir(), "fates-r1-ledger-"));
    try {
      const binding = new MockBinding();
      const instance = new Slice02Relay({
        binding,
        expectedOrigin: {
          runtime: "moirae-code",
          instanceId: "moirae-instance-1",
          artifact: "moirae-slice02-r1-host",
        },
        expectedAnanke: { instanceId: INSTANCE_ID, endpoint: ENDPOINT },
        requestIdentity: {
          version: "r1-v2",
          audience: R1_AUDIENCE,
          replayLedger: new DurableSlice02ReplayLedger(join(ledgerDirectory, "consumed.json")),
        },
        now: () => NOW,
      });

      const expired = await call(
        instance,
        r1RequestWithIdentity({
          originId: "moirae-r1-expired",
          audience: R1_AUDIENCE,
          validity: {
            notBefore: "2026-08-09T15:00:00.000Z",
            expiresAt: "2026-08-09T15:59:59.000Z",
          },
        }),
      );
      const wrongAudience = await call(
        instance,
        r1RequestWithIdentity({
          originId: "moirae-r1-wrong-audience",
          audience: slice02R1Audience("another-horae"),
          validity: {
            notBefore: "2026-08-09T15:59:00.000Z",
            expiresAt: "2026-08-09T16:00:30.000Z",
          },
        }),
      );
      const malformed = await call(
        instance,
        request({
          origin: {
            runtime: "moirae-code",
            instanceId: "moirae-instance-1",
            artifact: "moirae-slice02-r1-host",
            receipt: { schemaId: "urn:fates:invalid" },
          },
        }),
      );
      const legacyWithoutR1 = await call(instance, request());
      const first = await call(instance, r1Request());
      const replay = await call(instance, r1Request());

      expect(expired.body.state).toBe("stale");
      expect(wrongAudience.body.state).toBe("malformed");
      expect(malformed.body.state).toBe("malformed");
      expect(legacyWithoutR1.body.state).toBe("malformed");
      expect(first.body.dispatchState).toBe("result_received");
      expect(replay.body.state).toBe("denied");
      expect(replay.body.dispatchState).toBe("rejected_before_dispatch");
      expect(binding.dispatchCalls).toBe(1);
    } finally {
      rmSync(ledgerDirectory, { recursive: true, force: true });
    }
  });

  it("allows at most one progression for concurrent duplicate R1 requests", async () => {
    const ledgerDirectory = mkdtempSync(join(tmpdir(), "fates-r1-ledger-"));
    try {
      const binding = new MockBinding();
      binding.result = new Promise((resolve) =>
        setTimeout(
          () => resolve({ kind: "response", payload: { outcome: { state: "COMPLETED" } } }),
          20,
        ),
      );
      const instance = new Slice02Relay({
        binding,
        expectedOrigin: {
          runtime: "moirae-code",
          instanceId: "moirae-instance-1",
          artifact: "moirae-slice02-r1-host",
        },
        expectedAnanke: { instanceId: INSTANCE_ID, endpoint: ENDPOINT },
        requestIdentity: {
          version: "r1-v2",
          audience: R1_AUDIENCE,
          replayLedger: new DurableSlice02ReplayLedger(join(ledgerDirectory, "consumed.json")),
        },
        now: () => NOW,
      });

      const results = await Promise.all([call(instance, r1Request()), call(instance, r1Request())]);

      expect(
        results.filter((result) => result.body.dispatchState === "result_received"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.body.dispatchState === "rejected_before_dispatch"),
      ).toHaveLength(1);
      expect(binding.dispatchCalls).toBe(1);
    } finally {
      rmSync(ledgerDirectory, { recursive: true, force: true });
    }
  });
});

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
