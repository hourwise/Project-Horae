import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";

export const DEFAULT_R1_REPLAY_LEDGER_MAX_ENTRIES = 1_024;

export interface Slice02ReplayIdentity {
  originDigest: string;
  expiresAt: string;
}

export type Slice02ReplayClaim =
  { accepted: true } | { accepted: false; reason: "replayed" | "capacity" | "unavailable" };

export interface Slice02ReplayLedger {
  claim(identity: Slice02ReplayIdentity, nowMs: number): Slice02ReplayClaim;
}

interface PersistedLedger {
  version: 1;
  entries: Array<{ originDigest: string; expiresAt: string }>;
}

/**
 * A small host-local durable consumed-request ledger. Claims are synchronous
 * so a single Node host cannot interleave two claims between the capacity,
 * duplicate, and persistence checks. Persistence happens before the claim is
 * reported as accepted; a crash therefore fails closed for a consumed receipt.
 */
export class DurableSlice02ReplayLedger implements Slice02ReplayLedger {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly filePath: string,
    private readonly maxEntries = DEFAULT_R1_REPLAY_LEDGER_MAX_ENTRIES,
  ) {
    if (!isAbsolute(filePath)) throw new TypeError("R1 replay ledger path must be absolute");
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new TypeError("R1 replay ledger max entries must be a positive safe integer");
    }
    this.load();
  }

  claim(identity: Slice02ReplayIdentity, nowMs: number): Slice02ReplayClaim {
    const expiresAtMs = Date.parse(identity.expiresAt);
    if (Number.isNaN(expiresAtMs)) return { accepted: false, reason: "unavailable" };

    this.removeExpired(nowMs);
    if (this.entries.has(identity.originDigest)) {
      return { accepted: false, reason: "replayed" };
    }
    if (this.entries.size >= this.maxEntries) {
      return { accepted: false, reason: "capacity" };
    }

    this.entries.set(identity.originDigest, expiresAtMs);
    try {
      this.persist();
      return { accepted: true };
    } catch {
      this.entries.delete(identity.originDigest);
      return { accepted: false, reason: "unavailable" };
    }
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      throw new Error("R1 replay ledger is unavailable");
    }
    if (!isPersistedLedger(parsed)) throw new Error("R1 replay ledger is unavailable");
    for (const entry of parsed.entries) {
      const expiresAtMs = Date.parse(entry.expiresAt);
      if (!Number.isNaN(expiresAtMs)) this.entries.set(entry.originDigest, expiresAtMs);
    }
    if (this.entries.size > this.maxEntries) {
      throw new Error("R1 replay ledger exceeds its configured capacity");
    }
  }

  private removeExpired(nowMs: number): void {
    for (const [originDigest, expiresAtMs] of this.entries) {
      if (expiresAtMs <= nowMs) this.entries.delete(originDigest);
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const persisted: PersistedLedger = {
      version: 1,
      entries: [...this.entries.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([originDigest, expiresAtMs]) => ({
          originDigest,
          expiresAt: new Date(expiresAtMs).toISOString(),
        })),
    };
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(persisted)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      renameSync(temporaryPath, this.filePath);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  }
}

function isPersistedLedger(value: unknown): value is PersistedLedger {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) return false;
  return value.entries.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.originDigest === "string" &&
      /^[0-9a-f]{64}$/.test(entry.originDigest) &&
      typeof entry.expiresAt === "string" &&
      !Number.isNaN(Date.parse(entry.expiresAt)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
