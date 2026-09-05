import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "../src/config.js";
import { loadMandate, saveMandate, MandateNotFoundError } from "../src/mandate/store.js";
import type { Mandate } from "../src/mandate/schema.js";

let dir: string;
let originalMandatesDir: string;

function makeMandate(): Mandate {
  return {
    id: "00000000-0000-0000-0000-000000000099",
    version: 1,
    owner: "test",
    createdAt: new Date().toISOString(),
    subAccountId: "test-account",
    naturalLanguageSource: "test mandate",
    status: "active",
    limits: {
      perTradeMaxUsd: 50,
      dailySpendCapUsd: 500,
      maxLeverage: 1,
      dailyDrawdownHaltPct: 5,
      confirmAboveUsd: 20,
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "charter-mandate-store-test-"));
  originalMandatesDir = config.mandatesDir;
  config.mandatesDir = dir;
});

afterEach(() => {
  config.mandatesDir = originalMandatesDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("loadMandate", () => {
  it("throws MandateNotFoundError for a missing id", async () => {
    await expect(loadMandate("does-not-exist")).rejects.toBeInstanceOf(MandateNotFoundError);
  });

  it("MandateNotFoundError carries the requested id", async () => {
    try {
      await loadMandate("does-not-exist");
      expect.unreachable("expected loadMandate to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MandateNotFoundError);
      expect((err as MandateNotFoundError).mandateId).toBe("does-not-exist");
    }
  });

  it("throws a plain Error, not MandateNotFoundError, for malformed JSON", async () => {
    writeFileSync(path.join(dir, "broken.json"), "{ not valid json", "utf-8");
    await expect(loadMandate("broken")).rejects.not.toBeInstanceOf(MandateNotFoundError);
    await expect(loadMandate("broken")).rejects.toThrow();
  });

  it("round-trips a saved mandate", async () => {
    const mandate = makeMandate();
    await saveMandate(mandate);
    const loaded = await loadMandate(mandate.id);
    expect(loaded).toEqual(mandate);
  });
});
