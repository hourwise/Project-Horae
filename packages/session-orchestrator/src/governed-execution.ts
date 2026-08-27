import { createHash, randomUUID } from "node:crypto";
import type {
  CorrelationContext,
  HoraeProfile,
  HoraeSession,
  HoraeSessionRequest,
} from "@horae/schema";
import { SessionOrchestrator } from "./index.js";
import type {
  DurableEffectStatus,
  DurableExecutionStateStore,
} from "./durable-state.js";

/** The externally visible stages of Horae's governed execution route. */
export type GovernedExecutionState =
  | "received"
  | "composed"
  | "preflighted"
  | "admitted"
  | "executing"
  | "execution_intent_recorded"
  | "effect_attempted"
  | "effect_confirmed"
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
  /** Exact released surface; transport glue must carry it unchanged to admission. */
  surface?: unknown;
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
  /** Stable identity recorded before the executor is called. */
  effectId?: string;
}

export interface GovernedExecutor {
  run(input: GovernedExecutionInput): Promise<unknown>;
}

export interface GovernedExecutionHistoryEntry {
  state: GovernedExecutionState;
  occurredAt: string;
}

export interface GovernedExecutionRecord {
  /** SHA-256 of the complete caller/scope/operation binding. */
  bindingDigest?: string;
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
  /** Persisted before an effect call so recovery has a stable reconciliation key. */
  effectId?: string;
  effectStatus?: DurableEffectStatus;
  effectDigest?: string;
  preflight?: GovernedPreflightOutcome;
  admission?: GovernedAdmissionOutcome;
}

export type EffectReconciliationResult =
  | { status: "CONFIRMED"; output?: unknown }
  | { status: "ABSENT" }
  | { status: "UNKNOWN" };

export interface GovernedEffectReconciler {
  reconcile(input: {
    effectId: string;
    bindingDigest: string;
    request: GovernedExecutionRequest;
  }): Promise<EffectReconciliationResult>;
}

export type GovernedExecutionFaultPoint =
  | "after_receipt_before_authority"
  | "after_authority_before_admission"
  | "after_admission_before_intent"
  | "after_intent_before_effect"
  | "before_effect_invocation"
  | "after_effect_failure_before_recovery_record"
  | "after_effect_success_before_record"
  | "after_effect_confirmed_before_completed"
  | "after_completion_before_response";

/** Test-only signal for a process-equivalent crash after durable state was written. */
export class GovernedExecutionCrash extends Error {
  constructor(point: GovernedExecutionFaultPoint) {
    super(`simulated governed execution crash at ${point}`);
    this.name = "GovernedExecutionCrash";
  }
}

export interface GovernedExecutionCoordinatorOptions {
  orchestrator: SessionOrchestrator;
  ananke: GovernedAnankeBinding;
  mnemosyne: GovernedMnemosyneBinding;
  executor?: GovernedExecutor;
  timeoutMs?: number;
  now?: () => string;
  /** Optional owner-layer durable operation state. */
  stateStore?: DurableExecutionStateStore;
  /** Required to retry after an effect may have crossed its boundary. */
  effectReconciler?: GovernedEffectReconciler;
  /** Test-only deterministic fault injection at named transition boundaries. */
  faultInjector?: (point: GovernedExecutionFaultPoint) => void;
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Runs one request through composition -> Ananke -> Mnemosyne -> optional
 * executor. The route is deliberately transport-neutral and fail-closed.
 */
export class GovernedExecutionCoordinator {
  private readonly timeoutMs: number;
  private readonly now: () => string;
  private readonly inFlight = new Map<
    string,
    { requestId: string; promise: Promise<GovernedExecutionRecord> }
  >();
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
    if (this.options.stateStore) return this.executeDurably(input, signal);
    const binding = idempotencyBinding(input);
    const requestId = input.sessionRequest.correlation.requestId;
    const existing = this.records.get(binding);
    if (existing) {
      if (existing.requestId !== requestId) {
        return Promise.reject(new Error("idempotency key is bound to another request"));
      }
      return Promise.resolve(snapshot(existing));
    }
    const pending = this.inFlight.get(binding);
    if (pending) {
      if (pending.requestId !== requestId)
        return Promise.reject(new Error("idempotency key is bound to another in-flight request"));
      return pending.promise;
    }

    const run = this.run(input, signal).then((record) => {
      this.records.set(binding, record);
      this.inFlight.delete(binding);
      return snapshot(record);
    });
    this.inFlight.set(binding, { requestId, promise: run });
    return run;
  }

  /** Explicit retry path for a request that reached a recoverable terminal state. */
  recover(input: GovernedExecutionRequest, signal?: AbortSignal): Promise<GovernedExecutionRecord> {
    validateRequest(input);
    if (this.options.stateStore) {
      const binding = operationBindingDigest(input);
      const previous = this.options.stateStore.get(binding);
      if (!previous || !sameRequestBinding(previous, input, binding)) {
        return Promise.reject(new Error("request is not recoverable"));
      }
      return this.executeDurably(input, signal);
    }
    const binding = idempotencyBinding(input);
    const previous = this.records.get(binding);
    if (!previous || !["timed_out", "cancelled", "recovery_required"].includes(previous.state)) {
      return Promise.reject(new Error("request is not recoverable"));
    }
    if (!previous.retryable) {
      return Promise.reject(
        new Error("request effect outcome is unknown; reconciliation required"),
      );
    }
    this.records.delete(binding);
    return this.execute({ ...input, idempotencyKey: input.idempotencyKey }, signal).then(
      (record) => {
        const recovered = { ...record, recoveredFrom: previous.requestId };
        const stored = this.records.get(binding);
        if (stored) stored.recoveredFrom = previous.requestId;
        return recovered;
      },
    );
  }

  /**
   * Retrieve a completed record only with the original governed request
   * binding. A caller-controlled idempotency key alone is not a lookup
   * authority and is intentionally not accepted by this accessor.
   */
  get(input: GovernedExecutionRequest): GovernedExecutionRecord | undefined {
    validateRequest(input);
    if (this.options.stateStore) {
      const binding = operationBindingDigest(input);
      const record = this.options.stateStore.get(binding);
      if (!record || !sameRequestBinding(record, input, binding)) return undefined;
      return snapshot(record);
    }
    const record = this.records.get(idempotencyBinding(input));
    if (!record || record.requestId !== input.sessionRequest.correlation.requestId)
      return undefined;
    return snapshot(record);
  }

  private executeDurably(
    input: GovernedExecutionRequest,
    signal?: AbortSignal,
  ): Promise<GovernedExecutionRecord> {
    const binding = operationBindingDigest(input);
    const requestId = input.sessionRequest.correlation.requestId;
    const pending = this.inFlight.get(binding);
    if (pending) {
      if (pending.requestId !== requestId)
        return Promise.reject(new Error("idempotency key is bound to another in-flight request"));
      return pending.promise;
    }
    const run = this.runDurably(input, signal).finally(() => {
      const current = this.inFlight.get(binding);
      if (current?.promise === run) this.inFlight.delete(binding);
    });
    this.inFlight.set(binding, { requestId, promise: run });
    return run;
  }

  private async runDurably(
    input: GovernedExecutionRequest,
    externalSignal?: AbortSignal,
  ): Promise<GovernedExecutionRecord> {
    const store = this.options.stateStore;
    if (!store) throw new Error("durable execution state store is required");
    const binding = operationBindingDigest(input);
    let record = store.transaction(() => {
      const boundKey = store.getByIdempotencyKey(input.idempotencyKey);
      if (boundKey && (boundKey.bindingDigest !== binding || boundKey.requestId !== input.sessionRequest.correlation.requestId)) {
        throw new Error("IDEMPOTENCY_BINDING_MISMATCH");
      }
      const existing = store.get(binding);
      if (existing) {
        if (!sameRequestBinding(existing, input, binding))
          throw new Error("IDEMPOTENCY_BINDING_MISMATCH");
        return existing;
      }
      const created: GovernedExecutionRecord = {
        bindingDigest: binding,
        requestId: input.sessionRequest.correlation.requestId,
        idempotencyKey: input.idempotencyKey,
        correlation: input.sessionRequest.correlation,
        state: "received",
        history: [{ state: "received", occurredAt: this.now() }],
        retryable: false,
        effectId: `effect:${binding}`,
        effectStatus: "not_attempted",
      };
      store.put(binding, created);
      return created;
    });

    if (["completed", "denied", "quarantined"].includes(record.state)) return snapshot(record);

    const controller = new AbortController();
    let timedOut = false;
    let effectBoundaryReached = record.effectStatus === "attempted" || record.effectStatus === "unknown" || record.effectStatus === "confirmed";
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort("horae_timeout");
    }, this.timeoutMs);
    const abortExternal = () => controller.abort(externalSignal?.reason ?? "horae_cancelled");
    if (externalSignal?.aborted) abortExternal();
    else externalSignal?.addEventListener("abort", abortExternal, { once: true });

    try {
      this.options.faultInjector?.("after_receipt_before_authority");
      while (true) {
        if (["effect_confirmed"].includes(record.state) || record.effectStatus === "confirmed") {
          record = await this.completeConfirmed(input, record, binding);
          return snapshot(record);
        }
        if (["execution_intent_recorded", "executing", "effect_attempted", "recovery_required"].includes(record.state) && record.effectStatus !== "not_attempted") {
          const reconciliation = await this.reconcile(input, record, binding);
          if (reconciliation) {
            record = reconciliation;
            if (["completed", "recovery_required", "admitted"].includes(record.state)) {
              if (record.state === "admitted") continue;
              return snapshot(record);
            }
          }
        }
        if (["timed_out", "cancelled", "recovery_required"].includes(record.state) && record.effectStatus === "not_attempted") {
          record = await this.persistTransition(record, binding, "received", { retryable: false, reason: undefined });
          continue;
        }
        if (record.state === "received") {
          const session = this.options.orchestrator.start(input.sessionRequest, input.profile);
          record = await this.persistTransition(record, binding, "composed", {
            sessionId: session.id,
            compositionId: session.composition.id,
          });
          continue;
        }
        if (record.state === "composed") {
          const session = this.options.orchestrator.start(input.sessionRequest, input.profile);
          const preflight = record.preflight ?? await awaitWithAbort(
            this.options.ananke.preflight({ request: input, session, signal: controller.signal }),
            controller.signal,
          );
          record = await this.persistTransition(record, binding, "preflighted", {
            sessionId: session.id,
            compositionId: session.composition.id,
            observationId: preflight.observationId,
            decisionId: preflight.decisionId,
            preflight,
          });
          this.options.faultInjector?.("after_authority_before_admission");
          continue;
        }
        if (record.state === "preflighted") {
          const preflight = record.preflight;
          if (!preflight) throw new Error("durable preflight state is missing its authority result");
          if (preflight.action === "REQUIRE_APPROVAL" || preflight.action === "DENY") {
            record = await this.persistTransition(record, binding, "denied", {
              reason: preflight.reasonCode ?? "ananke_policy_denied",
              retryable: false,
            });
            return snapshot(record);
          }
          if (preflight.action === "QUARANTINE" || !preflight.receipt) {
            record = await this.persistTransition(record, binding, "quarantined", {
              reason: preflight.reasonCode ?? "preflight_receipt_required",
              retryable: false,
            });
            return snapshot(record);
          }
          const session = this.options.orchestrator.start(input.sessionRequest, input.profile);
          const admission = record.admission ?? await awaitWithAbort(
            this.options.mnemosyne.admit({ request: input, session, preflight, signal: controller.signal }),
            controller.signal,
          );
          record = await this.persistTransition(record, binding, "admitted", {
            admission,
            admissionId: admission.admissionId,
            candidateId: admission.candidateId,
            memoryId: admission.memoryId ?? input.memoryId,
          });
          if (["QUARANTINED", "REJECTED"].includes(admission.state)) {
            record = await this.persistTransition(record, binding, "quarantined", {
              reason: admission.reason ?? "mnemosyne_admission_rejected",
              retryable: admission.state === "QUARANTINED",
            });
            return snapshot(record);
          }
          this.options.faultInjector?.("after_admission_before_intent");
          continue;
        }
        if (record.state === "admitted") {
          if (!this.options.executor) {
            record = await this.persistTransition(record, binding, "completed", { retryable: false });
            return snapshot(record);
          }
          const session = this.options.orchestrator.start(input.sessionRequest, input.profile);
          const preflight = record.preflight;
          const admission = record.admission;
          if (!preflight || !admission) throw new Error("durable admitted state is missing governance evidence");
          const intent = await this.persistTransition(record, binding, "execution_intent_recorded", {
            effectId: record.effectId ?? `effect:${binding}`,
            effectStatus: "intent_recorded",
            retryable: false,
          });
          if (intent.state !== "execution_intent_recorded") {
            record = intent;
            continue;
          }
          this.options.faultInjector?.("after_intent_before_effect");
          record = await this.persistTransition(intent, binding, "executing", { effectStatus: "intent_recorded" });
          if (record.state !== "executing") continue;
          record = await this.persistTransition(record, binding, "effect_attempted", { effectStatus: "attempted" });
          if (record.state !== "effect_attempted") continue;
          effectBoundaryReached = true;
          this.options.faultInjector?.("before_effect_invocation");
          const output = await awaitWithAbort(
            this.options.executor.run({
              request: input,
              session,
              preflight,
              admission,
              signal: controller.signal,
              effectId: record.effectId,
            }),
            controller.signal,
          );
          this.options.faultInjector?.("after_effect_success_before_record");
          record = await this.persistTransition(record, binding, "effect_confirmed", {
            effectStatus: "confirmed",
            output,
            effectDigest: binding,
            retryable: false,
          });
          this.options.faultInjector?.("after_effect_confirmed_before_completed");
          record = await this.persistTransition(record, binding, "completed", { retryable: false });
          this.options.faultInjector?.("after_completion_before_response");
          return snapshot(record);
        }
        throw new Error(`unsupported durable execution state: ${record.state}`);
      }
    } catch (error) {
      if (error instanceof GovernedExecutionCrash) throw error;
      if (record.effectStatus === "confirmed") return snapshot(record);
      const unknown = effectBoundaryReached || record.effectStatus === "attempted" || record.effectStatus === "unknown";
      if (unknown) this.options.faultInjector?.("after_effect_failure_before_recovery_record");
      if (timedOut || controller.signal.aborted || unknown) {
        record = await this.persistFailure(record, binding, {
          state: unknown ? "recovery_required" : timedOut ? "timed_out" : "cancelled",
          reason: unknown
            ? timedOut
              ? "horae_timeout_effect_outcome_unknown"
              : "horae_effect_outcome_unknown"
            : timedOut
              ? "horae_timeout"
              : "horae_cancelled",
          retryable: !unknown,
          effectStatus: unknown ? "unknown" : "not_attempted",
        });
        return snapshot(record);
      }
      record = await this.persistFailure(record, binding, {
        state: "recovery_required",
        reason: "governed_route_failed",
        retryable: false,
        effectStatus: record.effectStatus,
      });
      return snapshot(record);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortExternal);
    }
  }

  private async reconcile(
    input: GovernedExecutionRequest,
    record: GovernedExecutionRecord,
    binding: string,
  ): Promise<GovernedExecutionRecord | undefined> {
    const effectId = record.effectId ?? `effect:${binding}`;
    const knownAbsent = record.effectStatus === "intent_recorded";
    const result = knownAbsent
      ? { status: "ABSENT" as const }
      : this.options.effectReconciler
        ? await this.options.effectReconciler.reconcile({ effectId, bindingDigest: binding, request: input })
        : { status: "UNKNOWN" as const };
    if (result.status === "CONFIRMED") {
      let next = record;
      if (next.state !== "effect_confirmed") {
        next = await this.persistTransition(next, binding, "effect_confirmed", {
          effectStatus: "confirmed",
          output: result.output,
          effectId,
          effectDigest: binding,
          retryable: false,
        });
      }
      if (next.state === "effect_confirmed") next = await this.persistTransition(next, binding, "completed", { retryable: false });
      return next;
    }
    if (result.status === "ABSENT") {
      if (["execution_intent_recorded", "executing", "effect_attempted", "recovery_required"].includes(record.state)) {
        return this.persistTransition(record, binding, "admitted", {
          effectStatus: "not_attempted",
          effectId,
          retryable: false,
          reason: undefined,
        });
      }
      return record;
    }
    if (record.state !== "recovery_required" || record.effectStatus !== "unknown") {
      return this.persistTransition(record, binding, "recovery_required", {
        effectStatus: "unknown",
        effectId,
        retryable: false,
        reason: "effect reconciliation required",
      });
    }
    return record;
  }

  private async completeConfirmed(
    input: GovernedExecutionRequest,
    record: GovernedExecutionRecord,
    binding: string,
  ): Promise<GovernedExecutionRecord> {
    if (record.state === "effect_confirmed") return this.persistTransition(record, binding, "completed", { retryable: false });
    return record;
  }

  private persistTransition(
    record: GovernedExecutionRecord,
    binding: string,
    state: GovernedExecutionState,
    patch: Partial<GovernedExecutionRecord> = {},
  ): Promise<GovernedExecutionRecord> {
    const store = this.options.stateStore;
    if (!store) throw new Error("durable execution state store is required");
    return Promise.resolve(store.transaction(() => {
      const current = store.get(binding);
      if (!current) throw new Error("durable execution record disappeared");
      if (current.history.length !== record.history.length || current.state !== record.state) return current;
      const next = { ...record, ...patch, history: record.history.map((entry) => ({ ...entry })) };
      transition(next, state, this.now);
      store.put(binding, next);
      return next;
    }));
  }

  private persistFailure(
    record: GovernedExecutionRecord,
    binding: string,
    failure: { state: GovernedExecutionState; reason: string; retryable: boolean; effectStatus?: DurableEffectStatus },
  ): Promise<GovernedExecutionRecord> {
    if (record.state === failure.state) {
      return Promise.resolve(this.options.stateStore!.transaction(() => {
        const current = this.options.stateStore!.get(binding);
        if (!current) throw new Error("durable execution record disappeared");
        const next = { ...current, reason: failure.reason, retryable: failure.retryable, effectStatus: failure.effectStatus ?? current.effectStatus };
        this.options.stateStore!.put(binding, next);
        return next;
      }));
    }
    return this.persistTransition(record, binding, failure.state, {
      reason: failure.reason,
      retryable: failure.retryable,
      effectStatus: failure.effectStatus,
    });
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
    let executionDispatched = false;
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
        executionDispatched = true;
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
        if (executionDispatched) {
          record.reason = "horae_timeout_effect_outcome_unknown";
          record.retryable = false;
          transition(record, "recovery_required", this.now);
        } else {
          record.reason = "horae_timeout";
          record.retryable = true;
          transition(record, "timed_out", this.now);
        }
      } else if (controller.signal.aborted) {
        if (executionDispatched) {
          record.reason = "horae_cancelled_effect_outcome_unknown";
          record.retryable = false;
          transition(record, "recovery_required", this.now);
        } else {
          record.reason = "horae_cancelled";
          record.retryable = true;
          transition(record, "cancelled", this.now);
        }
      } else {
        record.reason = "governed_route_failed";
        record.retryable = !executionDispatched;
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
  if (!input || typeof input !== "object")
    throw new TypeError("governed execution request is required");
  if (!KEY_PATTERN.test(input.idempotencyKey)) throw new TypeError("idempotencyKey is malformed");
  if (!input.source.sourceId.trim()) throw new TypeError("source.sourceId is required");
  if (!input.memoryId.trim()) throw new TypeError("memoryId is required");
}

/**
 * The caller-controlled idempotency key is only one part of an operation
 * binding. Scope and operation material prevent a key from becoming a
 * cross-project or cross-operation disclosure primitive. Request identity is
 * checked separately so an in-flight collision is rejected rather than shared.
 */
function idempotencyBinding(input: GovernedExecutionRequest): string {
  const execution = input.sessionRequest.execution as typeof input.sessionRequest.execution & {
    tenantId?: string;
    workspaceId?: string;
  };
  return stableJson({
    idempotencyKey: input.idempotencyKey,
    projectId: input.sessionRequest.projectId,
    tenantId: execution.tenantId,
    workspaceId: execution.workspaceId,
    scope: input.sessionRequest.scope,
    purpose: input.sessionRequest.purpose,
    profileId: input.profile.id,
    source: input.source,
    content: input.content,
    contentAccess: input.contentAccess,
    memoryId: input.memoryId,
  });
}

function operationBindingDigest(input: GovernedExecutionRequest): string {
  return `sha256:${createHash("sha256").update(idempotencyBinding(input), "utf8").digest("hex")}`;
}

function sameRequestBinding(
  record: GovernedExecutionRecord,
  input: GovernedExecutionRequest,
  binding: string,
): boolean {
  return record.bindingDigest === binding && record.requestId === input.sessionRequest.correlation.requestId && record.idempotencyKey === input.idempotencyKey;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function transition(
  record: GovernedExecutionRecord,
  state: GovernedExecutionState,
  now: () => string,
): void {
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
