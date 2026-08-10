import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DurableSlice02ReplayLedger } from "./replay-ledger.js";

const IDENTITY = {
  originDigest: "a".repeat(64),
  expiresAt: "2026-08-09T16:00:30.000Z",
};

describe("durable R1 replay ledger", () => {
  it("preserves consumed identity across a Horae restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "fates-r1-replay-"));
    try {
      const path = join(directory, "consumed.json");
      const first = new DurableSlice02ReplayLedger(path);
      expect(first.claim(IDENTITY, Date.parse("2026-08-09T16:00:00.000Z"))).toEqual({
        accepted: true,
      });

      const restarted = new DurableSlice02ReplayLedger(path);
      expect(restarted.claim(IDENTITY, Date.parse("2026-08-09T16:00:01.000Z"))).toEqual({
        accepted: false,
        reason: "replayed",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("cleans expired entries and fails closed at the retained-entry bound", () => {
    const directory = mkdtempSync(join(tmpdir(), "fates-r1-replay-"));
    try {
      const path = join(directory, "consumed.json");
      const ledger = new DurableSlice02ReplayLedger(path, 1);
      expect(
        ledger.claim(
          { ...IDENTITY, expiresAt: "2026-08-09T16:00:01.000Z" },
          Date.parse("2026-08-09T16:00:00.000Z"),
        ),
      ).toEqual({ accepted: true });
      expect(
        ledger.claim(
          { originDigest: "b".repeat(64), expiresAt: "2026-08-09T16:00:30.000Z" },
          Date.parse("2026-08-09T16:00:00.500Z"),
        ),
      ).toEqual({ accepted: false, reason: "capacity" });
      expect(
        ledger.claim(
          { originDigest: "b".repeat(64), expiresAt: "2026-08-09T16:00:30.000Z" },
          Date.parse("2026-08-09T16:00:02.000Z"),
        ),
      ).toEqual({ accepted: true });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
