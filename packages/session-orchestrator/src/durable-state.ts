import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
  GovernedExecutionRecord,
  GovernedExecutionState,
} from "./governed-execution.js";

const SCHEMA_VERSION = 2;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const STATES = new Set<GovernedExecutionState>([
  "received",
  "composed",
  "preflighted",
  "admitted",
  "executing",
  "execution_intent_recorded",
  "effect_attempted",
  "effect_confirmed",
  "completed",
  "denied",
  "quarantined",
  "cancelled",
  "timed_out",
  "recovery_required",
]);

const TRANSITIONS: Record<GovernedExecutionState, Set<GovernedExecutionState>> = {
  received: new Set(["composed", "recovery_required"]),
  composed: new Set(["preflighted", "recovery_required"]),
  preflighted: new Set(["admitted", "denied", "quarantined", "cancelled", "timed_out", "recovery_required"]),
  admitted: new Set(["execution_intent_recorded", "completed", "quarantined", "cancelled", "timed_out", "recovery_required"]),
  executing: new Set(["effect_attempted", "recovery_required"]),
  execution_intent_recorded: new Set(["executing", "effect_attempted", "admitted", "recovery_required"]),
  effect_attempted: new Set(["effect_confirmed", "admitted", "recovery_required"]),
  effect_confirmed: new Set(["completed"]),
  completed: new Set(),
  denied: new Set(),
  quarantined: new Set(),
  cancelled: new Set(["received"]),
  timed_out: new Set(["received"]),
  recovery_required: new Set(["received", "admitted", "effect_confirmed", "completed"]),
};

export type DurableEffectStatus =
  | "not_attempted"
  | "intent_recorded"
  | "attempted"
  | "confirmed"
  | "unknown";

export interface DurableDispatchClaim {
  ownerId: string;
  generation: number;
  claimedAt: string;
}

export type DispatchClaimResult =
  | { acquired: true; record: GovernedExecutionRecord }
  | { acquired: false; record: GovernedExecutionRecord };

export interface DurableExecutionStateStore {
  transaction<T>(operation: () => T): T;
  get(bindingDigest: string): GovernedExecutionRecord | undefined;
  getByIdempotencyKey(idempotencyKey: string): { bindingDigest: string; requestId: string } | undefined;
  claimDispatch(bindingDigest: string, ownerId: string, claimedAt: string): DispatchClaimResult;
  put(bindingDigest: string, record: GovernedExecutionRecord): void;
}

export class DurableExecutionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DurableExecutionStateError";
  }
}

interface DurableRecordEntry {
  bindingDigest: string;
  record: GovernedExecutionRecord;
}

interface DurableStateDocument {
  schemaVersion: number;
  records: DurableRecordEntry[];
  idempotencyBindings: Array<{ idempotencyKey: string; bindingDigest: string; requestId: string }>;
  checksum: string;
}

export interface DurableExecutionStateStoreOptions {
  filePath: string;
  maxLockWaitMs?: number;
}

/**
 * A deliberately small local durable store for governed execution records.
 * Writes are checksum-protected and atomically renamed while a cross-process
 * lock serializes read/modify/write transitions. It is not a distributed
 * database and does not claim protection from a malicious host filesystem.
 */
export class FileDurableExecutionStateStore implements DurableExecutionStateStore {
  private readonly filePath: string;
  private readonly lockPath: string;
  private readonly maxLockWaitMs: number;
  private transactionDepth = 0;
  private transactionRecords = new Map<string, GovernedExecutionRecord>();
  private transactionBindings = new Map<string, { bindingDigest: string; requestId: string }>();

  constructor(options: DurableExecutionStateStoreOptions) {
    if (!options.filePath.trim()) throw new TypeError("durable execution filePath is required");
    this.filePath = options.filePath;
    this.lockPath = `${options.filePath}.lock`;
    this.maxLockWaitMs = options.maxLockWaitMs ?? 5_000;
    if (!Number.isSafeInteger(this.maxLockWaitMs) || this.maxLockWaitMs <= 0) {
      throw new TypeError("durable execution maxLockWaitMs must be a positive safe integer");
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  transaction<T>(operation: () => T): T {
    if (this.transactionDepth > 0) return operation();
    const release = acquireLock(this.lockPath, this.maxLockWaitMs);
    this.transactionDepth = 1;
    const loaded = this.readState();
    this.transactionRecords = loaded.records;
    this.transactionBindings = loaded.bindings;
    try {
      const result = operation();
      this.writeRecords(this.transactionRecords);
      return result;
    } finally {
      this.transactionDepth = 0;
      this.transactionRecords = new Map();
      this.transactionBindings = new Map();
      release();
    }
  }

  get(bindingDigest: string): GovernedExecutionRecord | undefined {
    assertDigest(bindingDigest, "bindingDigest");
    const records = this.transactionDepth > 0 ? this.transactionRecords : this.readState().records;
    const record = records.get(bindingDigest);
    return record ? clone(record) : undefined;
  }

  getByIdempotencyKey(idempotencyKey: string): { bindingDigest: string; requestId: string } | undefined {
    if (!idempotencyKey.trim()) throw new DurableExecutionStateError("idempotencyKey is required");
    const bindings = this.transactionDepth > 0 ? this.transactionBindings : this.readState().bindings;
    const binding = bindings.get(idempotencyKey);
    return binding ? { ...binding } : undefined;
  }

  put(bindingDigest: string, record: GovernedExecutionRecord): void {
    assertDigest(bindingDigest, "bindingDigest");
    validateRecord(bindingDigest, record);
    const put = () => {
      this.transactionRecords.set(bindingDigest, clone(record));
      this.transactionBindings.set(record.idempotencyKey, { bindingDigest, requestId: record.requestId });
    };
    if (this.transactionDepth > 0) put();
    else this.transaction(put);
  }

  claimDispatch(bindingDigest: string, ownerId: string, claimedAt: string): DispatchClaimResult {
    assertDigest(bindingDigest, "bindingDigest");
    if (!ownerId.trim()) throw new DurableExecutionStateError("dispatch ownerId is required");
    if (!Number.isFinite(Date.parse(claimedAt))) throw new DurableExecutionStateError("dispatch claimedAt must be an ISO timestamp");
    return this.transaction(() => {
      const current = this.get(bindingDigest);
      if (!current) throw new DurableExecutionStateError("cannot claim dispatch for a missing execution record");
      if (current.dispatchClaim) return { acquired: false, record: current };
      if (current.state !== "execution_intent_recorded" || current.effectStatus !== "intent_recorded") {
        return { acquired: false, record: current };
      }
      const next = {
        ...current,
        dispatchClaim: {
          ownerId,
          generation: 1,
          claimedAt,
        },
      };
      this.put(bindingDigest, next);
      return { acquired: true, record: next };
    });
  }

  private readState(): { records: Map<string, GovernedExecutionRecord>; bindings: Map<string, { bindingDigest: string; requestId: string }> } {
    if (!existsSync(this.filePath)) return { records: new Map(), bindings: new Map() };
    let document: unknown;
    try {
      document = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new DurableExecutionStateError(
        `durable execution state is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isObject(document) || document.schemaVersion !== SCHEMA_VERSION || !Array.isArray(document.records) || !Array.isArray(document.idempotencyBindings) || typeof document.checksum !== "string") {
      throw new DurableExecutionStateError("durable execution state has an unsupported schema");
    }
    const unsigned = { schemaVersion: document.schemaVersion, records: document.records, idempotencyBindings: document.idempotencyBindings };
    if (checksum(unsigned) !== document.checksum) {
      throw new DurableExecutionStateError("durable execution state checksum mismatch");
    }
    const records = new Map<string, GovernedExecutionRecord>();
    for (const entry of document.records) {
      if (!isObject(entry) || typeof entry.bindingDigest !== "string") {
        throw new DurableExecutionStateError("durable execution state contains a malformed record entry");
      }
      assertDigest(entry.bindingDigest, "durable execution record bindingDigest");
      if (records.has(entry.bindingDigest)) {
        throw new DurableExecutionStateError("durable execution state contains conflicting duplicate records");
      }
      validateRecord(entry.bindingDigest, entry.record);
      records.set(entry.bindingDigest, clone(entry.record));
    }
    const bindings = new Map<string, { bindingDigest: string; requestId: string }>();
    for (const entry of document.idempotencyBindings) {
      if (!isObject(entry) || typeof entry.idempotencyKey !== "string" || typeof entry.requestId !== "string" || typeof entry.bindingDigest !== "string" || bindings.has(entry.idempotencyKey)) {
        throw new DurableExecutionStateError("durable execution state contains a malformed idempotency binding");
      }
      assertDigest(entry.bindingDigest, "durable execution idempotency binding");
      if (!records.has(entry.bindingDigest)) throw new DurableExecutionStateError("durable execution idempotency binding points to a missing record");
      const target = records.get(entry.bindingDigest)!;
      if (target.idempotencyKey !== entry.idempotencyKey || target.requestId !== entry.requestId) throw new DurableExecutionStateError("durable execution idempotency binding disagrees with its record");
      bindings.set(entry.idempotencyKey, { bindingDigest: entry.bindingDigest, requestId: entry.requestId });
    }
    if (bindings.size !== records.size) throw new DurableExecutionStateError("durable execution state is missing an idempotency binding");
    return { records, bindings };
  }

  private writeRecords(records: Map<string, GovernedExecutionRecord>): void {
    const entries = [...records.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([bindingDigest, record]) => ({ bindingDigest, record: clone(record) }));
    const unsigned = { schemaVersion: SCHEMA_VERSION, records: entries };
    const idempotencyBindings = [...this.transactionBindings.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([idempotencyKey, binding]) => ({ idempotencyKey, ...binding }));
    const withBindings = { ...unsigned, idempotencyBindings };
    const document: DurableStateDocument = { ...withBindings, checksum: checksum(withBindings) };
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(document), { encoding: "utf8", flag: "wx" });
    renameSync(temporary, this.filePath);
  }
}

function validateRecord(bindingDigest: string, record: unknown): asserts record is GovernedExecutionRecord {
  if (!isObject(record) || record.bindingDigest !== bindingDigest || typeof record.requestId !== "string" || typeof record.idempotencyKey !== "string" || typeof record.state !== "string" || !STATES.has(record.state as GovernedExecutionState) || !Array.isArray(record.history)) {
    throw new DurableExecutionStateError("durable execution record is malformed or binding-mismatched");
  }
  if (typeof record.effectId !== "string" || record.effectId !== `effect:${bindingDigest}` || !DIGEST_PATTERN.test(record.bindingDigest)) {
    throw new DurableExecutionStateError("durable execution record has no stable effect identity");
  }
  validatePrincipal(record.authenticatedPrincipal, "authenticatedPrincipal");
  validatePrincipal(record.actingPrincipal, "actingPrincipal");
  if (record.dispatchClaim !== undefined) {
    if (!isObject(record.dispatchClaim) || typeof record.dispatchClaim.ownerId !== "string" || !record.dispatchClaim.ownerId.trim() || !Number.isSafeInteger(record.dispatchClaim.generation) || record.dispatchClaim.generation <= 0 || typeof record.dispatchClaim.claimedAt !== "string" || !Number.isFinite(Date.parse(record.dispatchClaim.claimedAt))) {
      throw new DurableExecutionStateError("durable execution record has an invalid dispatch claim");
    }
    if (!["intent_recorded", "attempted", "confirmed", "unknown"].includes(record.effectStatus as string)) {
      throw new DurableExecutionStateError("durable execution record has a dispatch claim outside the effect lifecycle");
    }
  }
  if (!record.effectStatus || !["not_attempted", "intent_recorded", "attempted", "confirmed", "unknown"].includes(record.effectStatus)) {
    throw new DurableExecutionStateError("durable execution record has an invalid effect status");
  }
  if (record.history.length === 0) throw new DurableExecutionStateError("durable execution history cannot be empty");
  let previous: GovernedExecutionState | undefined;
  for (const entry of record.history) {
    if (!isObject(entry) || typeof entry.state !== "string" || !STATES.has(entry.state as GovernedExecutionState) || typeof entry.occurredAt !== "string" || !Number.isFinite(Date.parse(entry.occurredAt))) {
      throw new DurableExecutionStateError("durable execution history contains an invalid transition");
    }
    const state = entry.state as GovernedExecutionState;
    if (previous && !TRANSITIONS[previous].has(state) && previous !== state) {
      throw new DurableExecutionStateError(`illegal durable execution transition: ${previous} -> ${state}`);
    }
    previous = state;
  }
  if (previous !== record.state) throw new DurableExecutionStateError("durable execution state does not match its history");
  if (record.state === "effect_confirmed" || record.state === "completed") {
    if (record.effectStatus !== "confirmed") throw new DurableExecutionStateError("completed execution lacks confirmed effect state");
  }
  if (["execution_intent_recorded", "executing", "effect_attempted"].includes(record.state) && record.effectStatus === "not_attempted") {
    throw new DurableExecutionStateError("execution state crossed the intent boundary without effect state");
  }
}

function validatePrincipal(value: unknown, label: string): void {
  if (!isObject(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.kind !== "string" || !["human", "service", "agent", "runtime"].includes(value.kind)) {
    throw new DurableExecutionStateError(`durable execution record has an invalid ${label}`);
  }
  for (const key of ["issuer", "tenantId"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key].trim())) {
      throw new DurableExecutionStateError(`durable execution record has an invalid ${label}.${key}`);
    }
  }
  if (value.attributes !== undefined && (!isObject(value.attributes) || Object.entries(value.attributes).some(([key, entry]) => !key.trim() || typeof entry !== "string"))) {
    throw new DurableExecutionStateError(`durable execution record has invalid ${label}.attributes`);
  }
}

function assertDigest(value: string, label: string): void {
  if (!DIGEST_PATTERN.test(value)) throw new DurableExecutionStateError(`${label} must be a full sha256 digest`);
}

function checksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
      writeFileSync(join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid }), { encoding: "utf8", flag: "wx" });
      return () => {
        try { unlinkSync(join(lockPath, "owner.json")); } catch { /* already removed after a crash */ }
        try { rmdirSync(lockPath); } catch { /* another process recovered a stale lock */ }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let ownerPid: number | undefined;
      try { ownerPid = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8")).pid; } catch { /* owner is being created */ }
      if (ownerPid && !isProcessAlive(ownerPid)) {
        try { unlinkSync(join(lockPath, "owner.json")); } catch { /* raced with owner cleanup */ }
        try { rmdirSync(lockPath); } catch { /* raced with another recovery */ }
        continue;
      }
      if (Date.now() - startedAt >= maxWaitMs) throw new DurableExecutionStateError("timed out waiting for durable execution state lock");
      Atomics.wait(sleeper, 0, 0, 5);
    }
  }
}

function isProcessAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
