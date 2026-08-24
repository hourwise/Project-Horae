import { randomUUID } from "node:crypto";
import type {
  CorrelationContext,
  HoraeProfile,
  HoraeSession,
  HoraeSessionRequest,
} from "@horae/schema";
import { SessionOrchestrator } from "./index.js";

/** The externally visible stages of Horae's governed execution route. */
export type GovernedExecutionState =
  | "received"
  | "composed"
  | "preflighted"
  | "admitted"
  | "executing"
  | "completed"
  | "denied"
  | "quarantined"
  | "cancelled"
  | "timed_out"
  | "recovery_required";

export interface GovernedSourceReference {
  sourceId: string;
  canonicalPath?: string;
  sourceUri?: string;
  sourceHash?: string;
}

/**
 * Horae owns routing and lifecycle. Content, policy, and memory semantics stay
 * behind these two explicit bindings so the orchestrator cannot bypass them.
 */
export interface GovernedExecutionRequest {
  idempotencyKey: string;
  sessionRequest: HoraeSessionRequest;
  profile: HoraeProfile;
  source: GovernedSourceReference;
  content: unknown;
  contentAccess: unknown;
  memoryId: string;
}

export interface GovernedPreflightInput {
  request: GovernedExecutionRequest;
  session: HoraeSession;
  signal: AbortSignal;
}

export interface GovernedPreflightOutcome {
  action: "ALLOW" | "REQUIRE_APPROVAL" | "DENY" | "QUARANTINE";
  receipt?: unknown;
  observationId?: string;
  decisionId?: string;
  reasonCode?: string;
  grantedExposure?: string;
}

export interface GovernedAnankeBinding {
  preflight(input: GovernedPreflightInput): Promise<GovernedPreflightOutcome>;
}

export interface GovernedAdmissionInput {
  request: GovernedExecutionRequest;
  session: HoraeSession;
  preflight: GovernedPreflightOutcome;
  signal: AbortSignal;
}

export interface GovernedAdmissionOutcome {
  state: "ADMITTED" | "DUPLICATE" | "QUARANTINED" | "REJECTED";
  admissionId?: string;
  candidateId?: string;
  memoryId?: string;
  reason?: string;
}

export interface GovernedMnemosyneBinding {
  admit(input: GovernedAdmissionInput): Promise<GovernedAdmissionOutcome>;
}

export interface GovernedExecutionInput {
  request: GovernedExecutionRequest;
  session: HoraeSession;
  preflight: GovernedPreflightOutcome;
  admission: GovernedAdmissionOutcome;
  signal: AbortSignal;
}

export interface GovernedExecutor {
  run(input: GovernedExecutionInput): Promise<unknown>;
}

export interface GovernedExecutionHistoryEntry {
  state: GovernedExecutionState;
  occurredAt: string;
}

export interface GovernedExecutionRecord {
  requestId: string;
  idempotencyKey: string;
  correlation: CorrelationContext;
  state: GovernedExecutionState;
  history: GovernedExecutionHistoryEntry[];
  sessionId?: string;
  compositionId?: string;
  observationId?: string;
  decisionId?: string;
  admissionId?: string;
  candidateId?: string;
  memoryId?: string;
  output?: unknown;
  reason?: string;
  retryable: boolean;
  recoveredFrom?: string;
}

export interface GovernedExecutionCoordinatorOptions {
  orchestrator: SessionOrchestrator;
  ananke: GovernedAnankeBinding;
  mnemosyne: GovernedMnemosyneBinding;
  executor?: GovernedExecutor;
  timeoutMs?: number;
  now?: () => string;
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Runs one request through composition -> Ananke -> Mnemosyne -> optional
 * executor. The route is deliberately transport-neutral and fail-closed.
 */
export class GovernedExecutionCoordinator {
  private readonly timeoutMs: number;
  private readonly now: () => string;
  private readonly inFlight = new Map<string, Promise<GovernedExecutionRecord>>();
  private readonly records = new Map<string, GovernedExecutionRecord>();

  constructor(private readonly options: GovernedExecutionCoordinatorOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.now = options.now ?? (() => new Date().toISOString());
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError("Horae execution timeoutMs must be a positive safe integer");
    }
  }

  execute(input: GovernedExecutionRequest, signal?: AbortSignal): Promise<GovernedExecutionRecord> {
    validateRequest(input);
    const existing = this.records.get(input.idempotencyKey);
    if (existing) {
      if (existing.requestId !== input.sessionRequest.correlation.requestId) {
        return Promise.reject(new Error("idempotency key is bound to another request"));
      }
      return Promise.resolve(snapshot(existing));
    }
    const pending = this.inFlight.get(input.idempotencyKey);
    if (pending) return pending;

    const run = this.run(input, signal).then((record) => {
      this.records.set(input.idempotencyKey, record);
      this.inFlight.delete(input.idempotencyKey);
      return snapshot(record);
    });
    this.inFlight.set(input.idempotencyKey, run);
    return run;
  }

  /** Explicit retry path for a request that reached a recoverable terminal state. */
  recover(input: GovernedExecutionRequest, signal?: AbortSignal): Promise<GovernedExecutionRecord> {
    validateRequest(input);
    const previous = this.records.get(input.idempotencyKey);
    if (!previous || !["timed_out", "cancelled", "recovery_required"].includes(previous.state)) {
      return Promise.reject(new Error("request is not recoverable"));
    }
    this.records.delete(input.idempotencyKey);
    return this.execute({ ...input, idempotencyKey: input.idempotencyKey }, signal).then((record) => {
      const recovered = { ...record, recoveredFrom: previous.requestId };
      const stored = this.records.get(input.idempotencyKey);
      if (stored) stored.recoveredFrom = previous.requestId;
      return recovered;
    });
  }

  get(idempotencyKey: string): GovernedExecutionRecord | undefined {
    const record = this.records.get(idempotencyKey);
    return record ? snapshot(record) : undefined;
  }

  private async run(
    input: GovernedExecutionRequest,
    externalSignal?: AbortSignal,
  ): Promise<GovernedExecutionRecord> {
    const record: GovernedExecutionRecord = {
      requestId: input.sessionRequest.correlation.requestId,
      idempotencyKey: input.idempotencyKey,
      correlation: input.sessionRequest.correlation,
      state: "received",
      history: [{ state: "received", occurredAt: this.now() }],
      retryable: false,
    };
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort("horae_timeout");
    }, this.timeoutMs);
    const abortExternal = () => controller.abort(externalSignal?.reason ?? "horae_cancelled");
    if (externalSignal?.aborted) abortExternal();
    else externalSignal?.addEventListener("abort", abortExternal, { once: true });

    try {
      const session = this.options.orchestrator.start(input.sessionRequest, input.profile);
      record.sessionId = session.id;
      record.compositionId = session.composition.id;
      transition(record, "composed", this.now);
      throwIfAborted(controller.signal);

      const preflight = await awaitWithAbort(
        this.options.ananke.preflight({ request: input, session, signal: controller.signal }),
        controller.signal,
      );
      record.observationId = preflight.observationId;
      record.decisionId = preflight.decisionId;
      transition(record, "preflighted", this.now);
      throwIfAborted(controller.signal);
      if (preflight.action === "REQUIRE_APPROVAL" || preflight.action === "DENY") {
        record.reason = preflight.reasonCode ?? "ananke_policy_denied";
        record.retryable = false;
        transition(record, "denied", this.now);
        return record;
      }
      if (preflight.action === "QUARANTINE" || !preflight.receipt) {
        record.reason = preflight.reasonCode ?? "preflight_receipt_required";
        record.retryable = false;
        transition(record, "quarantined", this.now);
        return record;
      }

      const admission = await awaitWithAbort(
        this.options.mnemosyne.admit({
          request: input,
          session,
          preflight,
          signal: controller.signal,
        }),
        controller.signal,
      );
      record.admissionId = admission.admissionId;
      record.candidateId = admission.candidateId;
      record.memoryId = admission.memoryId ?? input.memoryId;
      if (admission.state === "QUARANTINED" || admission.state === "REJECTED") {
        record.reason = admission.reason ?? "mnemosyne_admission_rejected";
        record.retryable = admission.state === "QUARANTINED";
        transition(record, "quarantined", this.now);
        return record;
      }
      transition(record, "admitted", this.now);
      throwIfAborted(controller.signal);

      if (this.options.executor) {
        transition(record, "executing", this.now);
        record.output = await awaitWithAbort(
          this.options.executor.run({
            request: input,
            session,
            preflight,
            admission,
            signal: controller.signal,
          }),
          controller.signal,
        );
      }
      transition(record, "completed", this.now);
      return record;
    } catch (error) {
      if (timedOut) {
        record.reason = "horae_timeout";
        record.retryable = true;
        transition(record, "timed_out", this.now);
      } else if (controller.signal.aborted) {
        record.reason = "horae_cancelled";
        record.retryable = true;
        transition(record, "cancelled", this.now);
      } else {
        record.reason = "governed_route_failed";
        record.retryable = true;
        transition(record, "recovery_required", this.now);
      }
      return record;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortExternal);
    }
  }
}

function validateRequest(input: GovernedExecutionRequest): void {
  if (!KEY_PATTERN.test(input.idempotencyKey)) throw new TypeError("idempotencyKey is malformed");
  if (!input.source.sourceId.trim()) throw new TypeError("source.sourceId is required");
  if (!input.memoryId.trim()) throw new TypeError("memoryId is required");
}

function transition(record: GovernedExecutionRecord, state: GovernedExecutionState, now: () => string): void {
  record.state = state;
  record.history.push({ state, occurredAt: now() });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("governed route aborted");
}

async function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("governed route aborted");
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(new Error("governed route aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function snapshot(record: GovernedExecutionRecord): GovernedExecutionRecord {
  return {
    ...record,
    correlation: { ...record.correlation },
    history: record.history.map((entry) => ({ ...entry })),
  };
}

export function createGovernedRequestId(): string {
  return `horae_req_${randomUUID()}`;
}
