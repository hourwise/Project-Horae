import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const FATES_007A_SCHEMA_VERSION = "1" as const;
export const FATES_007A_DURABLE_ID_DOMAIN = "fates-007a/durable-execution/v1";
export const FATES_007A_AUTHORITY_DOMAIN = "fates-007a/authority-instance/v1";
export const FATES_007A_CLAIM_DOMAIN = "fates-007a/claim/v1";
export const FATES_007A_RECEIPT_DOMAIN = "fates-007a/effect-receipt/v1";

const HASH = /^[a-f0-9]{64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

export interface FatesOperationV1 {
  server: string;
  toolName: string;
  version: string;
}

export interface FatesPrincipalV1 {
  id: string;
  kind: string;
  issuer?: string;
  tenantId?: string;
  attributes?: Record<string, string>;
}

export interface FatesAuthorityContextV1 {
  authenticatedPrincipal: FatesPrincipalV1;
  actingPrincipal: FatesPrincipalV1;
  representedPrincipal?: FatesPrincipalV1;
  runtimeId: string;
  runtimeInstanceId: string;
  sessionId: string;
  tenantId?: string;
  projectId?: string;
  workspaceId?: string;
  resourceScope: Record<string, unknown>;
  correlation: {
    requestId: string;
    correlationId: string;
    causationId?: string;
    [key: string]: unknown;
  };
  policyVersion: string;
  purpose?: string;
}

export interface FatesAuthorityInstanceV1 {
  grantId: string;
  approvalActionHash: string;
  approvalBindingHash: string;
  expiresAt: string;
  bindRequestIdentity?: boolean;
  operatorId?: string;
  operatorSessionId?: string;
}

/** Structural mirror of Ananke's native FATES-007A handoff contract. */
export interface FatesAuthorityEnvelopeV1 {
  schemaVersion: typeof FATES_007A_SCHEMA_VERSION;
  operation: FatesOperationV1;
  nativeActionHash: string;
  durableExecutionId: string;
  authorityInstanceDigest: string;
  approval?: FatesAuthorityInstanceV1;
  authenticatedContext: FatesAuthorityContextV1;
  requestIdentity: { requestId: string; correlationId: string; causationId?: string };
  resourceScope: Record<string, unknown>;
  purpose: string;
  policyVersion: string;
  argumentsDigest: string;
  targetDigest: string;
  effectAdapter: { id: string; version: string };
}

export interface FatesClaimV1 {
  schemaVersion: typeof FATES_007A_SCHEMA_VERSION;
  durableExecutionId: string;
  owner: string;
  generation: number;
  claimedAt: string;
  claimDigest: string;
  nativeActionHash: string;
  authorityInstanceDigest: string;
  argumentsDigest: string;
  operation: FatesOperationV1;
  effectAdapter: { id: string; version: string };
}

export type FatesReceiptResult = "CONFIRMED" | "ABSENT" | "UNKNOWN";

export interface FatesEffectReceiptV1 {
  schemaVersion: typeof FATES_007A_SCHEMA_VERSION;
  durableExecutionId: string;
  nativeActionHash: string;
  operation: FatesOperationV1;
  authorityInstanceDigest: string;
  effectAdapter: { id: string; version: string };
  argumentsDigest: string;
  targetDigest: string;
  providerOperationId?: string;
  providerIdempotencyKey?: string;
  result: FatesReceiptResult;
  receiptProvenance: string;
  observedAt: string;
  resultDigest?: string;
  checksum: string;
}

export type Fates007aExecutionState =
  | "authority_validated"
  | "execution_reserved"
  | "executor_invocation_started"
  | "effect_reconciliation_required"
  | "terminal";

export interface Fates007aHistoryEntry {
  state: Fates007aExecutionState;
  occurredAt: string;
  event: string;
}

export interface Fates007aExecutionRecord {
  schemaVersion: typeof FATES_007A_SCHEMA_VERSION;
  durableExecutionId: string;
  durableEffectDigest: string;
  authority: FatesAuthorityEnvelopeV1;
  authorityInstanceDigest: string;
  nativeActionHash: string;
  operation: FatesOperationV1;
  argumentsDigest: string;
  targetDigest: string;
  effectAdapter: { id: string; version: string };
  state: Fates007aExecutionState;
  history: Fates007aHistoryEntry[];
  claim?: FatesClaimV1;
  receipt?: FatesEffectReceiptV1;
  result?: FatesReceiptResult;
  reason?: string;
  updatedAt: string;
}

export type FatesIntentResult =
  | { created: true; record: Fates007aExecutionRecord }
  | { created: false; record: Fates007aExecutionRecord };

export type FatesClaimResult =
  | { acquired: true; claim: FatesClaimV1; record: Fates007aExecutionRecord }
  | { acquired: false; record: Fates007aExecutionRecord };

export interface FatesClaimVerification {
  valid: boolean;
  reason?: string;
  state?: Fates007aExecutionState;
}

export class Fates007aStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Fates007aStoreError";
  }
}

interface Fates007aDocument {
  schemaVersion: number;
  records: Fates007aExecutionRecord[];
  checksum: string;
}

/**
 * FATES-007A local durable ledger. It is deliberately separate from the
 * FATES-005D schema so the accepted durable-dispatch behavior remains
 * byte-for-byte compatible. Atomic replacement plus a process lock provides
 * one-host, cross-process arbitration; it is not distributed consensus.
 */
export class FileFates007aExecutionStore {
  private readonly filePath: string;
  private readonly lockPath: string;
  private readonly maxLockWaitMs: number;

  constructor(options: { filePath: string; maxLockWaitMs?: number }) {
    if (!options.filePath.trim()) throw new TypeError("FATES-007A filePath is required");
    this.filePath = options.filePath;
    this.lockPath = `${options.filePath}.lock`;
    this.maxLockWaitMs = options.maxLockWaitMs ?? 5_000;
    if (!Number.isSafeInteger(this.maxLockWaitMs) || this.maxLockWaitMs <= 0)
      throw new TypeError("FATES-007A maxLockWaitMs must be positive");
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  get(durableExecutionId: string): Fates007aExecutionRecord | undefined {
    const record = this.readDocument().records.find(
      (entry) => entry.durableExecutionId === durableExecutionId,
    );
    return record ? clone(record) : undefined;
  }

  createExecutionIntent(authority: FatesAuthorityEnvelopeV1, now: string): FatesIntentResult {
    validateAuthority(authority);
    requireTimestamp(now, "now");
    return this.mutate((records) => {
      const index = records.findIndex(
        (entry) => entry.durableExecutionId === authority.durableExecutionId,
      );
      if (index >= 0) {
        const current = records[index];
        if (
          current.state === "authority_validated" &&
          !current.claim &&
          current.authorityInstanceDigest !== authority.authorityInstanceDigest
        ) {
          const renewed = {
            ...current,
            authority: clone(authority),
            authorityInstanceDigest: authority.authorityInstanceDigest,
            updatedAt: now,
          };
          records[index] = renewed;
          return { created: false, record: renewed };
        }
        if (stableJson(current.authority) !== stableJson(authority))
          throw new Fates007aStoreError(
            "durable execution identity is already bound to different authority material",
          );
        return { created: false, record: current };
      }
      const record: Fates007aExecutionRecord = {
        schemaVersion: FATES_007A_SCHEMA_VERSION,
        durableExecutionId: authority.durableExecutionId,
        durableEffectDigest: authority.durableExecutionId.slice("fates-execution:".length),
        authority: clone(authority),
        authorityInstanceDigest: authority.authorityInstanceDigest,
        nativeActionHash: authority.nativeActionHash,
        operation: clone(authority.operation),
        argumentsDigest: authority.argumentsDigest,
        targetDigest: authority.targetDigest,
        effectAdapter: clone(authority.effectAdapter),
        state: "authority_validated",
        history: [{ state: "authority_validated", occurredAt: now, event: "authority_validated" }],
        updatedAt: now,
      };
      records.push(record);
      return { created: true, record };
    });
  }

  claimDispatch(durableExecutionId: string, owner: string, claimedAt: string): FatesClaimResult {
    if (!owner.trim()) throw new Fates007aStoreError("claim owner is required");
    requireTimestamp(claimedAt, "claimedAt");
    return this.mutate((records) => {
      const current = requireRecord(records, durableExecutionId);
      if (current.claim) return { acquired: false, record: current };
      if (current.state !== "authority_validated") return { acquired: false, record: current };
      const claim = makeClaim(current, owner, 1, claimedAt);
      current.claim = claim;
      current.updatedAt = claimedAt;
      return { acquired: true, claim, record: current };
    });
  }

  /** Replaces a stale claim with a new generation; it never reopens UNKNOWN. */
  recoverClaim(durableExecutionId: string, owner: string, claimedAt: string): FatesClaimResult {
    if (!owner.trim()) throw new Fates007aStoreError("recovery claim owner is required");
    requireTimestamp(claimedAt, "claimedAt");
    return this.mutate((records) => {
      const current = requireRecord(records, durableExecutionId);
      if (current.state === "terminal") return { acquired: false, record: current };
      if (!current.claim) return { acquired: false, record: current };
      const generation = current.claim.generation + 1;
      const claim = makeClaim(current, owner, generation, claimedAt);
      current.claim = claim;
      current.updatedAt = claimedAt;
      return { acquired: true, claim, record: current };
    });
  }

  verifyClaim(authority: FatesAuthorityEnvelopeV1, claim: FatesClaimV1): FatesClaimVerification {
    try {
      validateAuthority(authority);
      validateClaim(claim);
      if (
        claim.durableExecutionId !== authority.durableExecutionId ||
        claim.nativeActionHash !== authority.nativeActionHash ||
        claim.authorityInstanceDigest !== authority.authorityInstanceDigest ||
        claim.argumentsDigest !== authority.argumentsDigest ||
        stableJson(claim.operation) !== stableJson(authority.operation) ||
        stableJson(claim.effectAdapter) !== stableJson(authority.effectAdapter)
      )
        return { valid: false, reason: "claim is not bound to the exact authority" };
      const record = this.get(authority.durableExecutionId);
      if (!record) return { valid: false, reason: "durable execution record is missing" };
      if (stableJson(record.authority) !== stableJson(authority))
        return { valid: false, reason: "authority material differs from persisted state" };
      if (!record.claim || stableJson(record.claim) !== stableJson(claim))
        return { valid: false, reason: "claim owner or generation is stale" };
      return { valid: true, state: record.state };
    } catch (error) {
      return { valid: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  reserveExecution(
    authority: FatesAuthorityEnvelopeV1,
    claim: FatesClaimV1,
    now: string,
  ): FatesClaimVerification {
    requireTimestamp(now, "now");
    return this.mutate((records) => {
      const current = requireRecord(records, authority.durableExecutionId);
      const verified = verifyAgainstRecord(current, authority, claim);
      if (!verified.valid) return verified;
      if (current.state === "authority_validated") {
        current.state = "execution_reserved";
        current.history.push({
          state: current.state,
          occurredAt: now,
          event: "execution_reserved",
        });
        current.updatedAt = now;
        return { valid: true, state: current.state };
      }
      if (current.state === "execution_reserved") return { valid: true, state: current.state };
      return {
        valid: false,
        reason: `execution cannot be reserved from state ${current.state}`,
        state: current.state,
      };
    });
  }

  markInvocationStarted(
    authority: FatesAuthorityEnvelopeV1,
    claim: FatesClaimV1,
    now: string,
  ): FatesClaimVerification {
    requireTimestamp(now, "now");
    return this.mutate((records) => {
      const current = requireRecord(records, authority.durableExecutionId);
      const verified = verifyAgainstRecord(current, authority, claim);
      if (!verified.valid) return verified;
      if (current.state === "execution_reserved") {
        current.state = "executor_invocation_started";
        current.history.push({
          state: current.state,
          occurredAt: now,
          event: "executor_invocation_started",
        });
        current.updatedAt = now;
        return { valid: true, state: current.state };
      }
      if (current.state === "executor_invocation_started")
        return { valid: true, state: current.state };
      return {
        valid: false,
        reason: `executor invocation cannot start from state ${current.state}`,
        state: current.state,
      };
    });
  }

  recordEffectReceipt(
    authority: FatesAuthorityEnvelopeV1,
    claim: FatesClaimV1,
    receipt: FatesEffectReceiptV1,
    now: string,
  ): Fates007aExecutionRecord {
    requireTimestamp(now, "now");
    validateReceipt(receipt, authority);
    return this.mutate((records) => {
      const current = requireRecord(records, authority.durableExecutionId);
      const verified = verifyAgainstRecord(current, authority, claim);
      if (!verified.valid)
        throw new Fates007aStoreError(verified.reason ?? "claim verification failed");
      if (current.receipt) {
        if (stableJson(current.receipt) === stableJson(receipt)) return current;
        if (
          current.result !== "UNKNOWN" ||
          current.state !== "effect_reconciliation_required" ||
          receipt.result === "UNKNOWN"
        )
          throw new Fates007aStoreError("durable execution already has a different effect receipt");
      }
      if (receipt.result === "UNKNOWN") {
        current.state = "effect_reconciliation_required";
        current.history.push({
          state: current.state,
          occurredAt: now,
          event: "effect_reconciliation_required",
        });
      } else {
        current.state = "terminal";
        current.history.push({
          state: current.state,
          occurredAt: now,
          event: `terminal_${receipt.result.toLowerCase()}`,
        });
      }
      current.receipt = clone(receipt);
      current.result = receipt.result;
      current.updatedAt = now;
      return current;
    });
  }

  private mutate<T>(operation: (records: Fates007aExecutionRecord[]) => T): T {
    const release = acquireLock(this.lockPath, this.maxLockWaitMs);
    try {
      const document = this.readDocument();
      const result = operation(document.records);
      this.writeDocument(document.records);
      return clone(result);
    } finally {
      release();
    }
  }

  private readDocument(): Fates007aDocument {
    if (!existsSync(this.filePath)) return { schemaVersion: 1, records: [], checksum: "" };
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new Fates007aStoreError(
        `FATES-007A durable state is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      !isObject(raw) ||
      raw.schemaVersion !== 1 ||
      !Array.isArray(raw.records) ||
      typeof raw.checksum !== "string"
    )
      throw new Fates007aStoreError("FATES-007A durable state has an unsupported schema");
    const unsigned = { schemaVersion: raw.schemaVersion, records: raw.records };
    if (checksum(unsigned) !== raw.checksum)
      throw new Fates007aStoreError("FATES-007A durable state checksum mismatch");
    for (const record of raw.records) validateRecord(record);
    return {
      schemaVersion: 1,
      records: raw.records.map((record) => clone(record)),
      checksum: raw.checksum,
    };
  }

  private writeDocument(records: Fates007aExecutionRecord[]): void {
    const sorted = records
      .slice()
      .sort((left, right) => left.durableExecutionId.localeCompare(right.durableExecutionId));
    const unsigned = { schemaVersion: 1, records: sorted.map((record) => clone(record)) };
    const document = { ...unsigned, checksum: checksum(unsigned) };
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(document), { encoding: "utf8", flag: "wx" });
    renameSync(temporary, this.filePath);
  }
}

export interface FatesClaimAwareAnankeBinding {
  executeClaimed(input: {
    authority: FatesAuthorityEnvelopeV1;
    claim: FatesClaimV1;
    args: Record<string, unknown>;
    now: string;
  }): Promise<{ status: FatesReceiptResult; receipt: FatesEffectReceiptV1 }>;
  reconcileClaimed(input: {
    authority: FatesAuthorityEnvelopeV1;
    claim: FatesClaimV1;
    args: Record<string, unknown>;
    now: string;
  }): Promise<{ status: FatesReceiptResult; receipt: FatesEffectReceiptV1 }>;
}

export class Fates007aExecutionCoordinator {
  constructor(
    private readonly store: FileFates007aExecutionStore,
    private readonly ananke: FatesClaimAwareAnankeBinding,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly faultInjector?: (point: Fates007aFaultPoint) => void,
  ) {}

  async execute(input: {
    authority: FatesAuthorityEnvelopeV1;
    args: Record<string, unknown>;
    owner: string;
    now?: string;
  }): Promise<Fates007aExecutionRecord> {
    const now = input.now ?? this.now();
    const intent = this.store.createExecutionIntent(input.authority, now).record;
    if (intent.state === "terminal" || intent.state === "effect_reconciliation_required")
      return intent;
    this.faultInjector?.("after_intent_before_claim");
    const claimResult = this.store.claimDispatch(
      input.authority.durableExecutionId,
      input.owner,
      now,
    );
    if (!claimResult.acquired) return claimResult.record;
    this.faultInjector?.("after_claim_before_ananke");
    const result = await this.ananke.executeClaimed({
      authority: input.authority,
      claim: claimResult.claim,
      args: input.args,
      now,
    });
    return this.store.recordEffectReceipt(input.authority, claimResult.claim, result.receipt, now);
  }

  async recover(input: {
    durableExecutionId: string;
    args: Record<string, unknown>;
    owner: string;
    now?: string;
  }): Promise<Fates007aExecutionRecord> {
    const current = this.store.get(input.durableExecutionId);
    if (!current) throw new Fates007aStoreError("cannot recover a missing FATES-007A execution");
    if (current.state === "terminal") return current;
    const now = input.now ?? this.now();
    const claimResult = this.store.recoverClaim(input.durableExecutionId, input.owner, now);
    if (!claimResult.acquired) return claimResult.record;
    this.faultInjector?.("after_recovery_claim_before_ananke");
    const authority = claimResult.record.authority;
    const result =
      current.state === "authority_validated" || current.state === "execution_reserved"
        ? await this.ananke.executeClaimed({
            authority,
            claim: claimResult.claim,
            args: input.args,
            now,
          })
        : await this.ananke.reconcileClaimed({
            authority,
            claim: claimResult.claim,
            args: input.args,
            now,
          });
    return this.store.recordEffectReceipt(authority, claimResult.claim, result.receipt, now);
  }
}

export type Fates007aFaultPoint =
  "after_intent_before_claim" | "after_claim_before_ananke" | "after_recovery_claim_before_ananke";

export function createFates007aClaimVerifier(
  store: FileFates007aExecutionStore,
  now: () => string = () => new Date().toISOString(),
): {
  verifyClaim(input: {
    authority: FatesAuthorityEnvelopeV1;
    claim: FatesClaimV1;
  }): Promise<FatesClaimVerification>;
  reserveExecution(input: {
    authority: FatesAuthorityEnvelopeV1;
    claim: FatesClaimV1;
  }): Promise<FatesClaimVerification>;
  markInvocationStarted(input: {
    authority: FatesAuthorityEnvelopeV1;
    claim: FatesClaimV1;
  }): Promise<FatesClaimVerification>;
} {
  return {
    verifyClaim: async ({ authority, claim }) => store.verifyClaim(authority, claim),
    reserveExecution: async ({ authority, claim }) =>
      store.reserveExecution(authority, claim, now()),
    markInvocationStarted: async ({ authority, claim }) =>
      store.markInvocationStarted(authority, claim, now()),
  };
}

export function createFates007aReceipt(
  input: Omit<FatesEffectReceiptV1, "schemaVersion" | "checksum">,
): FatesEffectReceiptV1 {
  const unsigned = stripUndefined({ schemaVersion: FATES_007A_SCHEMA_VERSION, ...input });
  const receipt = { ...unsigned, checksum: checksum(unsigned) } as FatesEffectReceiptV1;
  validateReceipt(receipt);
  return receipt;
}

export function computeFates007aDurableExecutionId(
  authority: Omit<
    FatesAuthorityEnvelopeV1,
    "durableExecutionId" | "authorityInstanceDigest" | "approval"
  >,
): string {
  return `fates-execution:${digestValue(FATES_007A_DURABLE_ID_DOMAIN, durableMaterial(authority))}`;
}

export function computeFates007aAuthorityInstanceDigest(
  authority: Pick<FatesAuthorityEnvelopeV1, "durableExecutionId" | "approval">,
): string {
  return digestValue(FATES_007A_AUTHORITY_DOMAIN, {
    durableExecutionId: authority.durableExecutionId,
    ...(authority.approval ?? { grantId: "admission-no-approval" }),
  });
}

export function computeFates007aClaimDigest(claim: Omit<FatesClaimV1, "claimDigest">): string {
  return digestValue(FATES_007A_CLAIM_DOMAIN, claim);
}

function durableMaterial(
  authority: Omit<
    FatesAuthorityEnvelopeV1,
    "durableExecutionId" | "authorityInstanceDigest" | "approval"
  >,
): Record<string, unknown> {
  return {
    requestIdentity: authority.requestIdentity,
    nativeActionHash: authority.nativeActionHash,
    operation: authority.operation,
    authenticatedContext: authority.authenticatedContext,
    resourceScope: authority.resourceScope,
    purpose: authority.purpose,
    policyVersion: authority.policyVersion,
    argumentsDigest: authority.argumentsDigest,
    targetDigest: authority.targetDigest,
    effectAdapter: authority.effectAdapter,
  };
}

function makeClaim(
  record: Fates007aExecutionRecord,
  owner: string,
  generation: number,
  claimedAt: string,
): FatesClaimV1 {
  const unsigned = {
    schemaVersion: FATES_007A_SCHEMA_VERSION,
    durableExecutionId: record.durableExecutionId,
    owner,
    generation,
    claimedAt,
    nativeActionHash: record.nativeActionHash,
    authorityInstanceDigest: record.authorityInstanceDigest,
    argumentsDigest: record.argumentsDigest,
    operation: record.operation,
    effectAdapter: record.effectAdapter,
  } satisfies Omit<FatesClaimV1, "claimDigest">;
  return { ...unsigned, claimDigest: computeFates007aClaimDigest(unsigned) };
}

function verifyAgainstRecord(
  record: Fates007aExecutionRecord,
  authority: FatesAuthorityEnvelopeV1,
  claim: FatesClaimV1,
): FatesClaimVerification {
  const verified = storeIndependentClaimCheck(record, authority, claim);
  if (!verified.valid) return verified;
  if (record.state === "terminal")
    return { valid: false, reason: "execution is already terminal", state: record.state };
  return verified;
}

function storeIndependentClaimCheck(
  record: Fates007aExecutionRecord,
  authority: FatesAuthorityEnvelopeV1,
  claim: FatesClaimV1,
): FatesClaimVerification {
  try {
    validateAuthority(authority);
    validateClaim(claim);
    if (
      record.durableExecutionId !== authority.durableExecutionId ||
      record.authorityInstanceDigest !== authority.authorityInstanceDigest ||
      stableJson(record.authority) !== stableJson(authority)
    )
      return {
        valid: false,
        reason: "authority differs from persisted record",
        state: record.state,
      };
    if (!record.claim || stableJson(record.claim) !== stableJson(claim))
      return { valid: false, reason: "claim owner or generation is stale", state: record.state };
    return { valid: true, state: record.state };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : String(error),
      state: record.state,
    };
  }
}

function validateAuthority(value: unknown): asserts value is FatesAuthorityEnvelopeV1 {
  if (
    !isObject(value) ||
    value.schemaVersion !== FATES_007A_SCHEMA_VERSION ||
    !isObject(value.operation) ||
    typeof value.nativeActionHash !== "string" ||
    !HASH.test(value.nativeActionHash) ||
    typeof value.durableExecutionId !== "string" ||
    !value.durableExecutionId.startsWith("fates-execution:sha256:") ||
    typeof value.authorityInstanceDigest !== "string" ||
    !DIGEST.test(value.authorityInstanceDigest) ||
    !isObject(value.authenticatedContext) ||
    !isObject(value.requestIdentity) ||
    !isObject(value.resourceScope) ||
    typeof value.purpose !== "string" ||
    !value.purpose.trim() ||
    typeof value.policyVersion !== "string" ||
    !value.policyVersion.trim() ||
    typeof value.argumentsDigest !== "string" ||
    !DIGEST.test(value.argumentsDigest) ||
    typeof value.targetDigest !== "string" ||
    !DIGEST.test(value.targetDigest) ||
    !isObject(value.effectAdapter)
  )
    throw new Fates007aStoreError("FATES-007A authority is malformed");
  if (
    value.approval !== undefined &&
    (!isObject(value.approval) ||
      typeof value.approval.grantId !== "string" ||
      !value.approval.grantId.trim() ||
      typeof value.approval.approvalActionHash !== "string" ||
      !HASH.test(value.approval.approvalActionHash) ||
      typeof value.approval.approvalBindingHash !== "string" ||
      !HASH.test(value.approval.approvalBindingHash) ||
      typeof value.approval.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.approval.expiresAt)) ||
      (value.approval.bindRequestIdentity !== undefined &&
        typeof value.approval.bindRequestIdentity !== "boolean") ||
      (value.approval.operatorId !== undefined && typeof value.approval.operatorId !== "string") ||
      (value.approval.operatorSessionId !== undefined &&
        typeof value.approval.operatorSessionId !== "string"))
  )
    throw new Fates007aStoreError("FATES-007A approval authority is malformed");
  if (
    computeFates007aDurableExecutionId(
      value as Omit<
        FatesAuthorityEnvelopeV1,
        "durableExecutionId" | "authorityInstanceDigest" | "approval"
      >,
    ) !== value.durableExecutionId
  )
    throw new Fates007aStoreError(
      "durable execution identity does not match canonical authority material",
    );
  if (
    computeFates007aAuthorityInstanceDigest(
      value as Pick<FatesAuthorityEnvelopeV1, "durableExecutionId" | "approval">,
    ) !== value.authorityInstanceDigest
  )
    throw new Fates007aStoreError(
      "authority instance digest does not match canonical authority material",
    );
}

function validateClaim(value: unknown): asserts value is FatesClaimV1 {
  if (
    !isObject(value) ||
    value.schemaVersion !== FATES_007A_SCHEMA_VERSION ||
    typeof value.durableExecutionId !== "string" ||
    typeof value.owner !== "string" ||
    !value.owner.trim() ||
    !Number.isSafeInteger(value.generation) ||
    value.generation <= 0 ||
    typeof value.claimedAt !== "string" ||
    !Number.isFinite(Date.parse(value.claimedAt)) ||
    typeof value.claimDigest !== "string" ||
    !DIGEST.test(value.claimDigest) ||
    typeof value.nativeActionHash !== "string" ||
    !HASH.test(value.nativeActionHash) ||
    typeof value.authorityInstanceDigest !== "string" ||
    !DIGEST.test(value.authorityInstanceDigest) ||
    typeof value.argumentsDigest !== "string" ||
    !DIGEST.test(value.argumentsDigest) ||
    !isObject(value.operation) ||
    !isObject(value.effectAdapter)
  )
    throw new Fates007aStoreError("FATES-007A claim is malformed");
  const unsigned = { ...value };
  delete unsigned.claimDigest;
  if (
    computeFates007aClaimDigest(unsigned as Omit<FatesClaimV1, "claimDigest">) !== value.claimDigest
  )
    throw new Fates007aStoreError("FATES-007A claim digest mismatch");
}

function validateReceipt(
  value: unknown,
  expected?: FatesAuthorityEnvelopeV1,
): asserts value is FatesEffectReceiptV1 {
  if (
    !isObject(value) ||
    value.schemaVersion !== FATES_007A_SCHEMA_VERSION ||
    typeof value.checksum !== "string" ||
    !DIGEST.test(value.checksum) ||
    typeof value.durableExecutionId !== "string" ||
    typeof value.nativeActionHash !== "string" ||
    !HASH.test(value.nativeActionHash) ||
    !isObject(value.operation) ||
    typeof value.authorityInstanceDigest !== "string" ||
    !DIGEST.test(value.authorityInstanceDigest) ||
    !isObject(value.effectAdapter) ||
    typeof value.argumentsDigest !== "string" ||
    !DIGEST.test(value.argumentsDigest) ||
    typeof value.targetDigest !== "string" ||
    !DIGEST.test(value.targetDigest) ||
    !["CONFIRMED", "ABSENT", "UNKNOWN"].includes(value.result as string) ||
    typeof value.receiptProvenance !== "string" ||
    !value.receiptProvenance.trim() ||
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt))
  )
    throw new Fates007aStoreError("FATES-007A effect receipt is malformed");
  const unsigned = { ...value };
  delete unsigned.checksum;
  if (checksum(unsigned) !== value.checksum)
    throw new Fates007aStoreError("FATES-007A effect receipt checksum mismatch");
  if (
    typeof value.providerOperationId !== "undefined" &&
    typeof value.providerOperationId !== "string"
  )
    throw new Fates007aStoreError("effect receipt provider operation identity is malformed");
  if (
    typeof value.providerIdempotencyKey !== "undefined" &&
    typeof value.providerIdempotencyKey !== "string"
  )
    throw new Fates007aStoreError("effect receipt provider idempotency identity is malformed");
  if (
    typeof value.resultDigest !== "undefined" &&
    (typeof value.resultDigest !== "string" || !DIGEST.test(value.resultDigest))
  )
    throw new Fates007aStoreError("effect receipt result digest is malformed");
  if (
    expected &&
    (value.durableExecutionId !== expected.durableExecutionId ||
      value.nativeActionHash !== expected.nativeActionHash ||
      stableJson(value.operation) !== stableJson(expected.operation) ||
      value.authorityInstanceDigest !== expected.authorityInstanceDigest ||
      value.argumentsDigest !== expected.argumentsDigest ||
      value.targetDigest !== expected.targetDigest ||
      stableJson(value.effectAdapter) !== stableJson(expected.effectAdapter))
  )
    throw new Fates007aStoreError("effect receipt binding mismatch");
}

function validateRecord(value: unknown): asserts value is Fates007aExecutionRecord {
  if (
    !isObject(value) ||
    value.schemaVersion !== FATES_007A_SCHEMA_VERSION ||
    typeof value.durableExecutionId !== "string" ||
    typeof value.durableEffectDigest !== "string" ||
    typeof value.authorityInstanceDigest !== "string" ||
    !DIGEST.test(value.authorityInstanceDigest) ||
    typeof value.nativeActionHash !== "string" ||
    !HASH.test(value.nativeActionHash) ||
    !isObject(value.operation) ||
    typeof value.argumentsDigest !== "string" ||
    !DIGEST.test(value.argumentsDigest) ||
    typeof value.targetDigest !== "string" ||
    !DIGEST.test(value.targetDigest) ||
    !isObject(value.effectAdapter) ||
    ![
      "authority_validated",
      "execution_reserved",
      "executor_invocation_started",
      "effect_reconciliation_required",
      "terminal",
    ].includes(value.state as string) ||
    !Array.isArray(value.history) ||
    value.history.length === 0 ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt))
  )
    throw new Fates007aStoreError("FATES-007A execution record is malformed");
  validateAuthority(value.authority);
  if (
    value.authority.durableExecutionId !== value.durableExecutionId ||
    value.authorityInstanceDigest !== value.authority.authorityInstanceDigest
  )
    throw new Fates007aStoreError("FATES-007A execution record authority binding mismatch");
  if (value.claim) validateClaim(value.claim);
  if (value.receipt) validateReceipt(value.receipt, value.authority);
  if (
    value.claim &&
    (value.claim.durableExecutionId !== value.durableExecutionId ||
      value.claim.nativeActionHash !== value.nativeActionHash ||
      value.claim.authorityInstanceDigest !== value.authorityInstanceDigest ||
      value.claim.argumentsDigest !== value.argumentsDigest ||
      stableJson(value.claim.operation) !== stableJson(value.operation) ||
      stableJson(value.claim.effectAdapter) !== stableJson(value.effectAdapter))
  )
    throw new Fates007aStoreError("FATES-007A claim binding mismatch");
  if (
    stableJson(value.operation) !== stableJson(value.authority.operation) ||
    value.nativeActionHash !== value.authority.nativeActionHash ||
    value.argumentsDigest !== value.authority.argumentsDigest ||
    value.targetDigest !== value.authority.targetDigest ||
    stableJson(value.effectAdapter) !== stableJson(value.authority.effectAdapter)
  )
    throw new Fates007aStoreError("FATES-007A execution identity fields do not match authority");
  const last = value.history[value.history.length - 1];
  if (
    !isObject(last) ||
    last.state !== value.state ||
    typeof last.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(last.occurredAt)) ||
    typeof last.event !== "string"
  )
    throw new Fates007aStoreError("FATES-007A execution history does not match state");
  if (value.state === "terminal" && !value.receipt)
    throw new Fates007aStoreError("terminal FATES-007A record has no receipt");
  if (value.state === "terminal" && value.result !== "CONFIRMED" && value.result !== "ABSENT")
    throw new Fates007aStoreError("terminal FATES-007A record must have final effect truth");
  if (value.state === "effect_reconciliation_required" && value.result !== "UNKNOWN")
    throw new Fates007aStoreError("reconciliation-required FATES-007A record must remain UNKNOWN");
}

function requireRecord(records: Fates007aExecutionRecord[], id: string): Fates007aExecutionRecord {
  const record = records.find((entry) => entry.durableExecutionId === id);
  if (!record) throw new Fates007aStoreError("FATES-007A durable execution record is missing");
  return record;
}

function requireTimestamp(value: string, name: string): void {
  if (!value.trim() || !Number.isFinite(Date.parse(value)))
    throw new Fates007aStoreError(`${name} must be an ISO timestamp`);
}

function digestValue(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableJson(value)}`, "utf8")
    .digest("hex")}`;
}

function checksum(value: unknown): string {
  return digestValue("fates-007a/checksum/v1", value);
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  throw new Fates007aStoreError("FATES-007A values must be JSON data");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => stripUndefined(entry)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefined(entry)]),
    ) as T;
  return value;
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function acquireLock(lockPath: string, maxWaitMs: number): () => void {
  mkdirSync(dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid }), {
        encoding: "utf8",
        flag: "wx",
      });
      return () => {
        try {
          unlinkSync(join(lockPath, "owner.json"));
        } catch {
          /* already removed */
        }
        try {
          rmdirSync(lockPath);
        } catch {
          /* raced */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let ownerPid: number | undefined;
      try {
        ownerPid = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8")).pid;
      } catch {
        /* owner is being created */
      }
      if (ownerPid && ownerPid !== process.pid) {
        try {
          process.kill(ownerPid, 0);
        } catch {
          try {
            unlinkSync(join(lockPath, "owner.json"));
          } catch {
            /* raced */
          }
          try {
            rmdirSync(lockPath);
          } catch {
            /* raced */
          }
          continue;
        }
      }
      if (Date.now() - startedAt >= maxWaitMs)
        throw new Fates007aStoreError("timed out waiting for FATES-007A lock");
      Atomics.wait(sleeper, 0, 0, 5);
    }
  }
}
