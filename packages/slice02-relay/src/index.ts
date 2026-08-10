import { createHash, randomUUID } from "node:crypto";
import { HttpAnankeInspectionBinding } from "@horae/ananke-binding";
import {
  assertContextConsistency,
  negotiateWithHorae,
  parseCorrelation,
  parseExecutionContext,
  parseResourceScope,
  type AgentExecutionContext,
  type CorrelationContext,
  type ResourceScope,
} from "@horae/adrasteia-adapter";
import { planCapabilities } from "@horae/capability-planner";
import { RuntimeRegistry, type PeerRegistrationCandidate } from "@horae/runtime-registry";
import type { Capability, PeerInspection, SupervisedRuntimeRegistration } from "@horae/schema";
import type { Slice02ReplayLedger } from "./replay-ledger.js";

export {
  DEFAULT_R1_REPLAY_LEDGER_MAX_ENTRIES,
  DurableSlice02ReplayLedger,
} from "./replay-ledger.js";
export type {
  Slice02ReplayClaim,
  Slice02ReplayIdentity,
  Slice02ReplayLedger,
} from "./replay-ledger.js";

export const SLICE02_ACTION = "fates.slice02.inspect-fixed-fixture.v1";
export const SLICE02_ROUTE_PATH = "/slice-02/governed-actions";
export const SLICE02_FIXTURE_ID = "fates.slice02.fixed-fixture.v1";
export const SLICE02_FIXTURE_SHA256 =
  "7b28f52d84b07bed8b49650960607e8f8a9809cac299810aba691f7f52fe9ae8";
export const SLICE02_REQUEST_SCHEMA_ID = "urn:fates:slice02:inspect-fixed-fixture-request:v1";
export const SLICE02_REQUEST_SCHEMA_SHA256 =
  "db1864fdc4978d6befb4b6d3913461e4f2d2732dd0ca87e076977ab98cf6049c";
export const SLICE02_R1_REQUEST_SCHEMA_ID = "urn:fates:slice02:inspect-fixed-fixture-request:r1-v2";
export const SLICE02_R1_REQUEST_SCHEMA_SHA256 =
  "104ebc4267914426434968996b2ba2e774ad4ffd6bc2fb4c97b4193a1c7389db";
export const SLICE02_R1_REQUEST_SCHEMA_DESCRIPTOR =
  "fates-slice-003a-r1-request-receipt-v2|action=fates.slice02.inspect-fixed-fixture.v1|receipt=originId,originDigest,schemaId,schemaSha256,audience,validity.notBefore,validity.expiresAt";
export const SLICE02_R1_AUDIENCE_PREFIX = "fates.slice03a.r1.horae:";

export const SLICE02_ANANKE_PRODUCER = Object.freeze({
  repository: "https://github.com/hourwise/Project-Ananke",
  checkpoint: "a54cb481958e5711afc1c92c622673f85e7e0178",
  tag: "ananke-fates-slice-002-v0.1.0-protocol-1.4.0",
  implementationCommit: "552686fe6e01e2c0bf41ccb52591076bfa68bc2c",
});

const MAX_READINESS_AGE_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 1_000;
const MAX_R1_VALIDITY_MS = 60_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const ACTION_ARGUMENT_KEYS = ["fixtureId", "expectedSha256"] as const;
const ORIGIN_KEYS = ["runtime", "instanceId", "artifact", "receipt"] as const;
const LEGACY_RECEIPT_KEYS = [
  "originDigest",
  "originId",
  "schemaId",
  "schemaSha256",
  "validity",
] as const;
const R1_RECEIPT_KEYS = [
  "audience",
  "originDigest",
  "originId",
  "schemaId",
  "schemaSha256",
  "validity",
] as const;

export type Slice02RequestIdentityVersion = "legacy-v1" | "r1-v2";

export type Slice02RouteState =
  | "completed"
  | "denied"
  | "unavailable"
  | "stale"
  | "incompatible"
  | "malformed"
  | "timed_out"
  | "indeterminate";

export type Slice02DispatchState =
  | "rejected_before_dispatch"
  | "dispatch_not_attempted"
  | "dispatch_confirmed"
  | "result_received"
  | "result_lost_indeterminate"
  | "timed_out_after_dispatch";

export interface Slice02ValidityReceipt {
  notBefore?: string;
  expiresAt: string;
}

export interface Slice02LegacyRequestMetadata {
  originId: string;
  originDigest: string;
  schemaId: typeof SLICE02_REQUEST_SCHEMA_ID;
  schemaSha256: typeof SLICE02_REQUEST_SCHEMA_SHA256;
  validity: Slice02ValidityReceipt;
}

export interface Slice02R1RequestMetadata {
  originId: string;
  originDigest: string;
  schemaId: typeof SLICE02_R1_REQUEST_SCHEMA_ID;
  schemaSha256: typeof SLICE02_R1_REQUEST_SCHEMA_SHA256;
  audience: string;
  validity: Slice02ValidityReceipt & { notBefore: string };
}

export type Slice02RequestMetadata = Slice02LegacyRequestMetadata | Slice02R1RequestMetadata;

export interface Slice02Origin {
  runtime: string;
  instanceId: string;
  artifact: string;
  receipt: Slice02RequestMetadata;
}

export interface Slice02HandoffRequest {
  action: typeof SLICE02_ACTION;
  arguments: {
    fixtureId: typeof SLICE02_FIXTURE_ID;
    expectedSha256: string;
  };
  origin: Slice02Origin;
  execution: AgentExecutionContext;
  scope: ResourceScope;
  purpose: string;
  correlation: CorrelationContext;
}

export interface Slice02ExpectedOrigin {
  runtime: string;
  instanceId: string;
  artifact: string;
}

export interface Slice02ExpectedAnanke {
  instanceId: string;
  endpoint: string;
  producer?: typeof SLICE02_ANANKE_PRODUCER;
}

export interface Slice02R1RequestIdentityOptions {
  version: "r1-v2";
  audience: string;
  replayLedger: Slice02ReplayLedger;
}

export interface Slice02RelayOptions {
  binding: Slice02AnankeBinding;
  expectedAnanke: Slice02ExpectedAnanke;
  expectedOrigin: Slice02ExpectedOrigin;
  authorizationHeader?: string | (() => string | undefined);
  registry?: RuntimeRegistry;
  now?: () => number;
  requestIdentity?: Slice02R1RequestIdentityOptions;
  inspectionTimeoutMs?: number;
  timeoutMs?: number;
}

export interface Slice02RouteReceipt {
  routeId: string;
  eventId: string;
  action: typeof SLICE02_ACTION;
  canonicalArgumentsDigest: string;
  origin: Slice02Origin;
  execution: AgentExecutionContext;
  scope: ResourceScope;
  purpose: string;
  validity: Slice02ValidityReceipt;
  correlation: CorrelationContext;
  ananke: {
    runtime: string;
    instanceId: string;
    endpoint: string;
    producer: typeof SLICE02_ANANKE_PRODUCER | undefined;
    negotiatedProtocol: string;
    readinessCheckedAt: string;
    readinessAgeMs: number;
  };
}

export interface Slice02RouteResult {
  state: Slice02RouteState;
  routeId: string;
  eventId: string;
  correlation: CorrelationContext;
  dispatchState: Slice02DispatchState;
  receipt?: Slice02RouteReceipt;
  ananke?: Slice02AnankeResult;
  producerEvidence?: Record<string, unknown>;
  reason?: string;
}

export interface Slice02ToolMetadata {
  name: string;
  server: string;
  riskClass: string;
  retryable: boolean;
  requiresApproval: boolean;
  inputSchema?: Record<string, unknown>;
}

export interface Slice02DispatchInput {
  arguments: Slice02HandoffRequest["arguments"];
  purpose: string;
  correlation: CorrelationContext;
  adapterMetadata: Slice02RequestMetadata;
  authorizationHeader?: string;
  timeoutMs: number;
}

export type Slice02DispatchResult =
  { kind: "response"; payload: unknown } | { kind: "timeout" } | { kind: "transport" };

export interface Slice02AnankeBinding {
  inspect(signal?: AbortSignal): Promise<PeerInspection>;
  inspectAction(signal?: AbortSignal): Promise<Slice02ToolMetadata>;
  dispatch(input: Slice02DispatchInput): Promise<Slice02DispatchResult>;
}

export interface Slice02AnankeOutcome {
  state: string;
  reasonCode?: string;
  retryable?: boolean;
  requiresUser?: boolean;
  safeToContinue?: boolean;
  nextAction?: string;
  data?: unknown;
  error?: string;
}

/** The allowlisted GatewayExecutionResult fields understood by this relay. */
export interface Slice02AnankeResult {
  outcome: Slice02AnankeOutcome;
  approvalRequired?: boolean;
  approvalGrantId?: string;
  evidence?: Record<string, unknown>;
}

class Slice02RequestError extends Error {
  constructor(
    readonly state: Slice02RouteState,
    message: string,
  ) {
    super(message);
    this.name = "Slice02RequestError";
  }
}

/**
 * HTTP is deliberately implemented as a Slice-02-specific binding. It has no
 * arbitrary tool or path parameter and performs one dispatch call at most.
 */
export class HttpSlice02AnankeBinding implements Slice02AnankeBinding {
  private readonly inspection: HttpAnankeInspectionBinding;
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly request: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.inspection = new HttpAnankeInspectionBinding(this.baseUrl, request);
  }

  inspect(signal?: AbortSignal): Promise<PeerInspection> {
    return this.inspection.inspect(signal);
  }

  async inspectAction(signal?: AbortSignal): Promise<Slice02ToolMetadata> {
    const response = await this.request(
      `${this.baseUrl}/api/tools/${encodeURIComponent(SLICE02_ACTION)}`,
      {
        method: "GET",
        headers: { accept: "application/json" },
        ...(signal ? { signal } : {}),
      },
    );
    if (!response.ok) throw new Error("Slice 02 action inspection unavailable");
    return (await response.json()) as Slice02ToolMetadata;
  }

  async dispatch(input: Slice02DispatchInput): Promise<Slice02DispatchResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "x-ananke-correlation-id": input.correlation.correlationId,
    };
    if (input.correlation.causationId) {
      headers["x-ananke-causation-id"] = input.correlation.causationId;
    }
    if (input.authorizationHeader) headers.authorization = input.authorizationHeader;

    const requestPromise = this.request(`${this.baseUrl}/api/execute`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        toolName: SLICE02_ACTION,
        arguments: input.arguments,
        purpose: input.purpose,
        adapterMetadata: input.adapterMetadata,
      }),
    })
      .then(async (response): Promise<Slice02DispatchResult> => {
        if (!response.ok) return { kind: "transport" };
        try {
          return { kind: "response", payload: await response.json() };
        } catch {
          return { kind: "transport" };
        }
      })
      .catch((): Slice02DispatchResult => ({ kind: "transport" }));

    const timeoutPromise = new Promise<Slice02DispatchResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: "timeout" });
      }, input.timeoutMs);
    });

    try {
      return await Promise.race([requestPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }
}

export class Slice02Relay {
  private readonly registry: RuntimeRegistry;
  private readonly now: () => number;
  private readonly inspectionTimeoutMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: Slice02RelayOptions) {
    this.registry = options.registry ?? new RuntimeRegistry();
    this.now = options.now ?? (() => Date.now());
    this.inspectionTimeoutMs = options.inspectionTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.inspectionTimeoutMs) || this.inspectionTimeoutMs <= 0) {
      throw new TypeError("Slice 02 inspectionTimeoutMs must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError("Slice 02 timeoutMs must be a positive safe integer");
    }
    if (!options.expectedAnanke.instanceId || !options.expectedAnanke.endpoint) {
      throw new TypeError("Slice 02 requires a pinned Ananke instance and endpoint");
    }
    if (options.requestIdentity && !isCanonicalR1Audience(options.requestIdentity.audience)) {
      throw new TypeError("Slice 02 R1 audience is malformed");
    }
  }

  /** Native Request/Response surface equivalent to POST /slice-02/governed-actions. */
  async handle(request: Request): Promise<Response> {
    const routeId = `route_${randomUUID()}`;
    const eventId = `event_${randomUUID()}`;
    if (new URL(request.url).pathname !== "/slice-02/governed-actions") {
      return this.respond({
        state: "malformed",
        routeId,
        eventId,
        correlation: fallbackCorrelation(routeId),
        dispatchState: "rejected_before_dispatch",
        reason: "unknown route",
      });
    }
    if (request.method !== "POST") {
      return this.respond({
        state: "malformed",
        routeId,
        eventId,
        correlation: fallbackCorrelation(routeId),
        dispatchState: "rejected_before_dispatch",
        reason: "method not allowed",
      });
    }

    let input: Slice02HandoffRequest;
    try {
      input = parseRequest(
        await request.json(),
        this.options.expectedOrigin,
        this.now(),
        this.options.requestIdentity,
      );
    } catch (error) {
      if (error instanceof Slice02RequestError) {
        return this.respond({
          state: error.state,
          routeId,
          eventId,
          correlation: fallbackCorrelation(routeId),
          dispatchState: "rejected_before_dispatch",
          reason: error.message,
        });
      }
      return this.respond({
        state: "malformed",
        routeId,
        eventId,
        correlation: fallbackCorrelation(routeId),
        dispatchState: "rejected_before_dispatch",
        reason: "malformed Slice 02 request",
      });
    }

    return this.respond(await this.relay(input, routeId, eventId));
  }

  private async relay(
    input: Slice02HandoffRequest,
    routeId: string,
    eventId: string,
  ): Promise<Slice02RouteResult> {
    const base = {
      routeId,
      eventId,
      correlation: input.correlation,
      dispatchState: "dispatch_not_attempted" as const,
    };
    const identityRejection = this.claimApplicationIdentity(input);
    if (identityRejection) return { ...base, ...identityRejection };
    const preDispatch = await this.inspectBeforeDispatch(input);
    if (preDispatch.kind === "timeout") {
      return {
        ...base,
        state: "timed_out",
        reason: "Ananke pre-dispatch inspection timed out",
      };
    }
    if (preDispatch.kind === "failure") return { ...base, ...preDispatch.result };
    const { inspection, admission, action } = preDispatch;

    const negotiatedProtocol = negotiateWithHorae(
      inspection.identity.protocolVersion,
      inspection.identity.minimumProtocolVersion ?? inspection.identity.protocolVersion,
    );
    const readinessCheckedAt = inspection.readiness.checkedAt;
    if (!readinessCheckedAt) {
      return { ...base, state: "stale", reason: "Ananke readiness has no timestamp" };
    }
    const readinessAgeMs = Math.max(0, this.now() - Date.parse(readinessCheckedAt));
    const producer = producerAttestation(inspection);
    const receipt: Slice02RouteReceipt = {
      routeId,
      eventId,
      action: SLICE02_ACTION,
      canonicalArgumentsDigest: hashCanonical(input.arguments),
      origin: input.origin,
      execution: input.execution,
      scope: input.scope,
      purpose: input.purpose,
      validity: input.origin.receipt.validity,
      correlation: input.correlation,
      ananke: {
        runtime: inspection.identity.runtime,
        instanceId: inspection.identity.instanceId!,
        endpoint: this.options.expectedAnanke.endpoint,
        producer,
        negotiatedProtocol: negotiatedProtocol.negotiatedVersion!,
        readinessCheckedAt,
        readinessAgeMs,
      },
    };

    const authorizationHeader =
      typeof this.options.authorizationHeader === "function"
        ? this.options.authorizationHeader()
        : this.options.authorizationHeader;
    const dispatch = await this.options.binding.dispatch({
      arguments: input.arguments,
      purpose: input.purpose,
      correlation: input.correlation,
      adapterMetadata: input.origin.receipt,
      authorizationHeader,
      timeoutMs: this.timeoutMs,
    });

    if (dispatch.kind === "timeout") {
      return {
        ...base,
        state: "timed_out",
        dispatchState: "timed_out_after_dispatch",
        receipt,
        reason: "authoritative Ananke result timed out",
      };
    }
    if (dispatch.kind === "transport") {
      return {
        ...base,
        state: "indeterminate",
        dispatchState: "result_lost_indeterminate",
        receipt,
        reason: "Ananke transport lost after dispatch",
      };
    }

    const producerResult = parseAnankeResult(dispatch.payload);
    if (!producerResult) {
      return {
        ...base,
        state: "indeterminate",
        dispatchState: "result_lost_indeterminate",
        receipt,
        reason: "Ananke returned no authoritative typed result",
      };
    }

    return {
      ...base,
      state: producerResult.outcome.state === "COMPLETED" ? "completed" : "denied",
      dispatchState: "result_received",
      receipt,
      ananke: producerResult,
      ...(producerResult.evidence ? { producerEvidence: producerResult.evidence } : {}),
    };
  }

  private claimApplicationIdentity(
    input: Slice02HandoffRequest,
  ): Pick<Slice02RouteResult, "state" | "reason" | "dispatchState"> | undefined {
    const identityOptions = this.options.requestIdentity;
    if (!identityOptions) return undefined;
    const receipt = input.origin.receipt;
    if (receipt.schemaId !== SLICE02_R1_REQUEST_SCHEMA_ID) {
      return {
        state: "malformed",
        dispatchState: "rejected_before_dispatch",
        reason: "R1 application request identity schema is required",
      };
    }
    const claim = identityOptions.replayLedger.claim(
      { originDigest: receipt.originDigest, expiresAt: receipt.validity.expiresAt },
      this.now(),
    );
    if (claim.accepted) return undefined;
    if (claim.reason === "replayed") {
      return {
        state: "denied",
        dispatchState: "rejected_before_dispatch",
        reason: "R1 application request identity was already consumed",
      };
    }
    return {
      state: "unavailable",
      dispatchState: "rejected_before_dispatch",
      reason:
        claim.reason === "capacity"
          ? "R1 application replay ledger capacity reached"
          : "R1 application replay ledger unavailable",
    };
  }

  private async inspectBeforeDispatch(input: Slice02HandoffRequest): Promise<
    | {
        kind: "success";
        inspection: PeerInspection;
        admission: SupervisedRuntimeRegistration;
        action: Slice02ToolMetadata;
      }
    | { kind: "timeout" }
    | { kind: "failure"; result: Pick<Slice02RouteResult, "state" | "reason"> }
  > {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inspectionPromise = (async () => {
      // This is intentionally performed on every request immediately before
      // the action endpoint is inspected or dispatched.
      const inspection = await this.options.binding.inspect(controller.signal);
      throwIfAborted(controller.signal);
      const admission = this.registry.admit({
        id: "ananke-slice02",
        registration: inspection.registration,
        compatibility: inspection.compatibility,
        source: "ananke-public-http-inspection",
        observedAt: new Date(this.now()).toISOString(),
      });
      const admissionFailure = admissionFailureState(admission);
      if (admissionFailure) return { kind: "failure" as const, result: admissionFailure };

      const reinspectionFailure = validateAnankeInspection(
        inspection,
        this.options.expectedAnanke,
        this.now(),
      );
      if (reinspectionFailure) return { kind: "failure" as const, result: reinspectionFailure };

      const action = await this.options.binding.inspectAction(controller.signal);
      throwIfAborted(controller.signal);
      const actionFailure = validateSlice02Action(action);
      if (actionFailure) return { kind: "failure" as const, result: actionFailure };
      const capabilityFailure = validateReducedActionCapability(input, admission, action);
      if (capabilityFailure) return { kind: "failure" as const, result: capabilityFailure };
      return { kind: "success" as const, inspection, admission, action };
    })();
    const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: "timeout" });
      }, this.inspectionTimeoutMs);
    });

    try {
      return await Promise.race([inspectionPromise, timeoutPromise]);
    } catch {
      return {
        kind: "failure",
        result: { state: "unavailable", reason: "Ananke inspection unavailable" },
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private respond(result: Slice02RouteResult): Response {
    return new Response(JSON.stringify(result), {
      status: routeStatus(result.state, result.dispatchState),
      headers: { "content-type": "application/json" },
    });
  }
}

export function createSlice02Route(relay: Slice02Relay): (request: Request) => Promise<Response> {
  return (request) => relay.handle(request);
}

function parseRequest(
  value: unknown,
  expectedOrigin: Slice02ExpectedOrigin,
  nowMs: number,
  identityOptions?: Slice02R1RequestIdentityOptions,
): Slice02HandoffRequest {
  const root = recordWithKeys(value, [
    "action",
    "arguments",
    "origin",
    "execution",
    "scope",
    "purpose",
    "correlation",
  ]);
  if (root.action !== SLICE02_ACTION) throw new TypeError("unsupported action");
  const args = recordWithKeys(root.arguments, ACTION_ARGUMENT_KEYS);
  if (
    args.fixtureId !== SLICE02_FIXTURE_ID ||
    typeof args.expectedSha256 !== "string" ||
    !DIGEST_PATTERN.test(args.expectedSha256)
  ) {
    throw new TypeError("malformed Slice 02 arguments");
  }
  const origin = recordWithKeys(root.origin, ORIGIN_KEYS);
  if (
    origin.runtime !== expectedOrigin.runtime ||
    origin.instanceId !== expectedOrigin.instanceId ||
    origin.artifact !== expectedOrigin.artifact
  ) {
    throw new TypeError("unsupported origin identity");
  }
  const receipt = identityOptions
    ? parseR1Receipt(origin.receipt, identityOptions.audience, nowMs)
    : parseLegacyReceipt(origin.receipt, nowMs);
  if (typeof root.purpose !== "string" || root.purpose.trim().length === 0) {
    throw new TypeError("purpose is required");
  }
  const execution = parseExecutionContext(root.execution);
  const scope = parseResourceScope(root.scope);
  const correlation = parseCorrelation(root.correlation);
  const projectId = execution.projectId ?? scope.projectId;
  if (!projectId) throw new TypeError("bounded project context is required");
  assertContextConsistency(execution, scope, projectId);
  return {
    action: SLICE02_ACTION,
    arguments: { fixtureId: SLICE02_FIXTURE_ID, expectedSha256: args.expectedSha256 },
    origin: {
      runtime: origin.runtime as string,
      instanceId: origin.instanceId as string,
      artifact: origin.artifact as string,
      receipt,
    },
    execution,
    scope,
    purpose: root.purpose,
    correlation,
  };
}

function parseLegacyReceipt(value: unknown, nowMs: number): Slice02LegacyRequestMetadata {
  const receipt = recordWithKeys(value, LEGACY_RECEIPT_KEYS);
  if (
    typeof receipt.originId !== "string" ||
    !ID_PATTERN.test(receipt.originId) ||
    typeof receipt.originDigest !== "string" ||
    !DIGEST_PATTERN.test(receipt.originDigest) ||
    receipt.schemaId !== SLICE02_REQUEST_SCHEMA_ID ||
    receipt.schemaSha256 !== SLICE02_REQUEST_SCHEMA_SHA256
  )
    throw new Slice02RequestError("malformed", "malformed origin/schema receipt");
  const validity = recordWithKeys(receipt.validity, ["expiresAt", "notBefore"], true);
  if (typeof validity.expiresAt !== "string" || Number.isNaN(Date.parse(validity.expiresAt))) {
    throw new Slice02RequestError("malformed", "malformed validity");
  }
  if (
    validity.notBefore !== undefined &&
    (typeof validity.notBefore !== "string" || Number.isNaN(Date.parse(validity.notBefore)))
  ) {
    throw new Slice02RequestError("malformed", "malformed validity");
  }
  const notBefore = validity.notBefore as string | undefined;
  if ((notBefore && nowMs < Date.parse(notBefore)) || nowMs >= Date.parse(validity.expiresAt)) {
    throw new Slice02RequestError("stale", "application request validity is not current");
  }
  if (receipt.originDigest !== slice02OriginDigest(receipt.originId)) {
    throw new Slice02RequestError("malformed", "origin digest does not match receipt");
  }
  return {
    originId: receipt.originId,
    originDigest: receipt.originDigest,
    schemaId: SLICE02_REQUEST_SCHEMA_ID,
    schemaSha256: SLICE02_REQUEST_SCHEMA_SHA256,
    validity: {
      ...(notBefore ? { notBefore } : {}),
      expiresAt: validity.expiresAt,
    },
  };
}

function parseR1Receipt(
  value: unknown,
  expectedAudience: string,
  nowMs: number,
): Slice02R1RequestMetadata {
  const receipt = recordWithKeys(value, R1_RECEIPT_KEYS);
  if (
    typeof receipt.originId !== "string" ||
    !ID_PATTERN.test(receipt.originId) ||
    typeof receipt.originDigest !== "string" ||
    !DIGEST_PATTERN.test(receipt.originDigest) ||
    receipt.schemaId !== SLICE02_R1_REQUEST_SCHEMA_ID ||
    receipt.schemaSha256 !== SLICE02_R1_REQUEST_SCHEMA_SHA256 ||
    receipt.audience !== expectedAudience
  ) {
    throw new Slice02RequestError("malformed", "malformed R1 application request identity");
  }
  const validity = recordWithKeys(receipt.validity, ["expiresAt", "notBefore"]);
  if (
    typeof validity.notBefore !== "string" ||
    Number.isNaN(Date.parse(validity.notBefore)) ||
    typeof validity.expiresAt !== "string" ||
    Number.isNaN(Date.parse(validity.expiresAt))
  ) {
    throw new Slice02RequestError("malformed", "malformed R1 application request validity");
  }
  const notBefore = Date.parse(validity.notBefore);
  const expiresAt = Date.parse(validity.expiresAt);
  if (
    notBefore > nowMs ||
    nowMs >= expiresAt ||
    expiresAt <= notBefore ||
    expiresAt - notBefore > MAX_R1_VALIDITY_MS
  ) {
    throw new Slice02RequestError("stale", "R1 application request validity is not current");
  }
  if (
    receipt.originDigest !==
    slice02R1OriginDigest({
      originId: receipt.originId,
      audience: receipt.audience,
      validity: { notBefore: validity.notBefore, expiresAt: validity.expiresAt },
    })
  ) {
    throw new Slice02RequestError("malformed", "R1 application request identity digest mismatch");
  }
  return {
    originId: receipt.originId,
    originDigest: receipt.originDigest,
    schemaId: SLICE02_R1_REQUEST_SCHEMA_ID,
    schemaSha256: SLICE02_R1_REQUEST_SCHEMA_SHA256,
    audience: expectedAudience,
    validity: { notBefore: validity.notBefore, expiresAt: validity.expiresAt },
  };
}

export function slice02OriginDigest(originId: string): string {
  return hashCanonical({
    originId,
    schemaId: SLICE02_REQUEST_SCHEMA_ID,
    schemaSha256: SLICE02_REQUEST_SCHEMA_SHA256,
  });
}

export function slice02R1OriginDigest(input: {
  originId: string;
  audience: string;
  validity: Slice02R1RequestMetadata["validity"];
}): string {
  return hashCanonical({
    action: SLICE02_ACTION,
    audience: input.audience,
    originId: input.originId,
    schemaId: SLICE02_R1_REQUEST_SCHEMA_ID,
    schemaSha256: SLICE02_R1_REQUEST_SCHEMA_SHA256,
    validity: input.validity,
  });
}

export function slice02R1Audience(instanceId: string): string {
  if (!ID_PATTERN.test(instanceId)) throw new TypeError("R1 Horae instance ID is malformed");
  return `${SLICE02_R1_AUDIENCE_PREFIX}${instanceId}:POST:${SLICE02_ROUTE_PATH}`;
}

function isCanonicalR1Audience(value: string): boolean {
  return (
    value.startsWith(SLICE02_R1_AUDIENCE_PREFIX) &&
    value.endsWith(`:POST:${SLICE02_ROUTE_PATH}`) &&
    ID_PATTERN.test(
      value.slice(
        SLICE02_R1_AUDIENCE_PREFIX.length,
        value.length - `:POST:${SLICE02_ROUTE_PATH}`.length,
      ),
    )
  );
}

function validateAnankeInspection(
  inspection: PeerInspection,
  expected: Slice02ExpectedAnanke,
  nowMs: number,
): Pick<Slice02RouteResult, "state" | "reason"> | undefined {
  if (
    inspection.identity.runtime !== "ananke" ||
    inspection.identity.instanceId !== expected.instanceId
  ) {
    return { state: "incompatible", reason: "Ananke identity drifted" };
  }
  if (inspection.compatibility.runtimeName !== "ananke") {
    return { state: "incompatible", reason: "Ananke compatibility identity drifted" };
  }
  const negotiation = negotiateWithHorae(
    inspection.compatibility.protocolVersion,
    inspection.compatibility.minimumSupportedProtocolVersion,
  );
  if (!negotiation.compatible)
    return { state: "incompatible", reason: "Ananke protocol is incompatible" };
  const endpoint = inspection.registration.endpoints?.find(
    (candidate) => candidate.transport === "http" && candidate.url === expected.endpoint,
  );
  if (!endpoint) return { state: "incompatible", reason: "Ananke endpoint drifted" };
  if (!inspection.health.healthy) return { state: "unavailable", reason: "Ananke is unhealthy" };
  if (!inspection.readiness.ready) return { state: "unavailable", reason: "Ananke is not ready" };
  const dependencies = inspection.readiness.dependencies ?? [];
  if (dependencies.some((dependency) => dependency.required && dependency.status !== "ready")) {
    return { state: "unavailable", reason: "Ananke dependency is not ready" };
  }
  const checkedAt = inspection.readiness.checkedAt;
  if (!checkedAt || Number.isNaN(Date.parse(checkedAt)))
    return { state: "stale", reason: "Ananke readiness timestamp is invalid" };
  const ageMs = Math.max(0, nowMs - Date.parse(checkedAt));
  if (ageMs > MAX_READINESS_AGE_MS) return { state: "stale", reason: "Ananke readiness is stale" };
  const annotations = inspection.identity.metadata?.annotations;
  const expectedProducer = expected.producer ?? SLICE02_ANANKE_PRODUCER;
  if (
    annotations?.["fates.slice02.producerRepository"] !== expectedProducer.repository ||
    annotations?.["fates.slice02.producerCheckpoint"] !== expectedProducer.checkpoint ||
    annotations?.["fates.slice02.producerTag"] !== expectedProducer.tag ||
    annotations?.["fates.slice02.implementationCommit"] !== expectedProducer.implementationCommit
  )
    return { state: "incompatible", reason: "Ananke producer authority drifted" };
  return undefined;
}

function validateSlice02Action(
  action: Slice02ToolMetadata,
): Pick<Slice02RouteResult, "state" | "reason"> | undefined {
  const schema = action.inputSchema;
  const properties = schema?.properties;
  const required = schema?.required;
  if (
    action.name !== SLICE02_ACTION ||
    action.server !== "ananke.slice02" ||
    action.riskClass !== "READ_ONLY" ||
    action.retryable !== false ||
    action.requiresApproval !== false ||
    schema?.additionalProperties !== false ||
    !Array.isArray(required) ||
    required.length !== 2 ||
    !required.includes("fixtureId") ||
    !required.includes("expectedSha256") ||
    !isRecord(properties) ||
    !isRecord(properties.fixtureId) ||
    properties.fixtureId.const !== SLICE02_FIXTURE_ID ||
    !isRecord(properties.expectedSha256) ||
    properties.expectedSha256.pattern !== "^[0-9a-f]{64}$"
  )
    return { state: "incompatible", reason: "Slice 02 action capability drifted" };
  return undefined;
}

function validateReducedActionCapability(
  input: Slice02HandoffRequest,
  admitted: SupervisedRuntimeRegistration,
  action: Slice02ToolMetadata,
): Pick<Slice02RouteResult, "state" | "reason"> | undefined {
  const capability: Capability = {
    id: action.name,
    name: action.name,
    version: "1.0.0",
    category: "execution" as NonNullable<Capability["category"]>,
    exposure: "active" as NonNullable<Capability["exposure"]>,
    dependencyState: "available" as NonNullable<Capability["dependencyState"]>,
  };
  const registration: SupervisedRuntimeRegistration = {
    ...admitted,
    registration: {
      ...admitted.registration,
      capabilities: [...(admitted.registration.capabilities ?? []), capability],
    },
  };
  const projectId = input.execution.projectId ?? input.scope.projectId!;
  const plan = planCapabilities(
    {
      projectId,
      profileId: "fates-slice-002",
      task: SLICE02_ACTION,
      purpose: input.purpose,
      execution: input.execution,
      scope: input.scope,
      correlation: input.correlation,
      requestedCapabilities: [SLICE02_ACTION],
      requiredCapabilities: [SLICE02_ACTION],
    },
    {
      id: "fates-slice-002",
      displayName: "Fates Slice 02",
      projectId,
      requiredRuntimeCapabilities: [SLICE02_ACTION],
      allowedRuntimeCapabilities: [SLICE02_ACTION],
      auditDestinations: [],
      capabilityExposure: "fixed",
    },
    [registration],
  );
  return plan.visible.some((candidate) => candidate.id === SLICE02_ACTION)
    ? undefined
    : { state: "incompatible", reason: "Slice 02 action was reduced away" };
}

function admissionFailureState(
  admission: SupervisedRuntimeRegistration,
): Pick<Slice02RouteResult, "state" | "reason"> | undefined {
  if (admission.admission.state === "admitted" || admission.admission.state === "constrained")
    return undefined;
  if (
    admission.admission.state === "incompatible" ||
    admission.admission.state === "identity_mismatch"
  ) {
    return { state: "incompatible", reason: "Ananke admission evidence is incompatible" };
  }
  return { state: "unavailable", reason: "Ananke admission is incomplete" };
}

function producerAttestation(
  inspection: PeerInspection,
): typeof SLICE02_ANANKE_PRODUCER | undefined {
  const annotations = inspection.identity.metadata?.annotations;
  if (
    annotations?.["fates.slice02.producerRepository"] !== SLICE02_ANANKE_PRODUCER.repository ||
    annotations?.["fates.slice02.producerCheckpoint"] !== SLICE02_ANANKE_PRODUCER.checkpoint ||
    annotations?.["fates.slice02.producerTag"] !== SLICE02_ANANKE_PRODUCER.tag ||
    annotations?.["fates.slice02.implementationCommit"] !==
      SLICE02_ANANKE_PRODUCER.implementationCommit
  )
    return undefined;
  return SLICE02_ANANKE_PRODUCER;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Ananke pre-dispatch inspection aborted");
}

export function parseAnankeResult(value: unknown): Slice02AnankeResult | undefined {
  if (!isRecord(value) || !Object.hasOwn(value, "outcome")) return undefined;
  const outcome = parseAnankeOutcome(value.outcome);
  if (!outcome) return undefined;
  const result: Slice02AnankeResult = { outcome };
  if (Object.hasOwn(value, "approvalRequired")) {
    if (typeof value.approvalRequired !== "boolean") return undefined;
    result.approvalRequired = value.approvalRequired;
  }
  if (Object.hasOwn(value, "approvalGrantId")) {
    if (typeof value.approvalGrantId !== "string") return undefined;
    result.approvalGrantId = value.approvalGrantId;
  }
  if (Object.hasOwn(value, "evidence")) {
    if (!isRecord(value.evidence)) return undefined;
    result.evidence = cloneRecord(value.evidence);
  }
  return result;
}

function parseAnankeOutcome(value: unknown): Slice02AnankeOutcome | undefined {
  if (!isRecord(value) || !Object.hasOwn(value, "state") || typeof value.state !== "string")
    return undefined;
  const outcome: Slice02AnankeOutcome = { state: value.state };
  const stringKeys = ["reasonCode", "nextAction", "error"] as const;
  for (const key of stringKeys) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== "string") return undefined;
      outcome[key] = value[key] as string;
    }
  }
  const booleanKeys = ["retryable", "requiresUser", "safeToContinue"] as const;
  for (const key of booleanKeys) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== "boolean") return undefined;
      outcome[key] = value[key] as boolean;
    }
  }
  if (Object.hasOwn(value, "data")) outcome.data = cloneJsonValue(value.data);
  return outcome;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: cloneJsonValue(value[key]),
      writable: true,
    });
  }
  return result;
}

function cloneJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item));
  if (isRecord(value)) return cloneRecord(value);
  return undefined;
}

function recordWithKeys(
  value: unknown,
  keys: readonly string[],
  allowOptional = false,
): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("expected object");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  const valid = allowOptional
    ? actual.every((key) => expected.includes(key))
    : actual.length === expected.length && actual.every((key, index) => key === expected[index]);
  if (!valid) throw new TypeError("unexpected object properties");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hashCanonical(value: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("unsupported canonical value");
}

function fallbackCorrelation(routeId: string): CorrelationContext {
  return { requestId: routeId, correlationId: routeId };
}

function routeStatus(state: Slice02RouteState, dispatchState?: Slice02DispatchState): number {
  switch (state) {
    case "malformed":
      return 400;
    case "incompatible":
      return 409;
    case "unavailable":
    case "stale":
      return 503;
    case "timed_out":
      return 504;
    case "indeterminate":
      return 502;
    case "denied":
      return dispatchState === "rejected_before_dispatch" ? 403 : 200;
    default:
      return 200;
  }
}
