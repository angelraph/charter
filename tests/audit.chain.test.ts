import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLog } from "../src/audit/log.js";

let dir: string;
let logPath: string;
let log: AuditLog;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "charter-audit-test-"));
  logPath = path.join(dir, "audit.log.jsonl");
  log = new AuditLog(logPath);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("AuditLog", () => {
  it("starts with an empty, valid chain", async () => {
    const result = await log.verify();
    expect(result.ok).toBe(true);
  });

  it("hash-links each entry to the previous one", async () => {
    await log.append("MANDATE_CREATED", "n/a", { note: "first" });
    await log.append("PROPOSAL_RECEIVED", "testnet", { note: "second" });
    const entries = await log.all();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.prevHash).toBe("GENESIS");
    expect(entries[1]!.prevHash).toBe(entries[0]!.hash);
  });

  it("verifies an untampered chain of several entries", async () => {
    for (let i = 0; i < 5; i++) {
      await log.append("PROPOSAL_RECEIVED", "testnet", { i });
    }
    const result = await log.verify();
    expect(result.ok).toBe(true);
  });

  it("detects tampering with a single field in an earlier entry", async () => {
    await log.append("PROPOSAL_RECEIVED", "testnet", { notionalUsd: 15 });
    await log.append("VERDICT_ISSUED", "testnet", { decision: "PASS" });
    await log.append("EXECUTION_FILLED", "testnet", { orderId: "123" });

    const raw = readFileSync(logPath, "utf-8");
    const tampered = raw.replace('"notionalUsd":15', '"notionalUsd":15000');
    expect(tampered).not.toBe(raw);
    writeFileSync(logPath, tampered, "utf-8");

    const result = await log.verify();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.brokenAtSeq).toBe(0);
    }
  });

  it("detects a broken prevHash link even if individual hashes are internally consistent", async () => {
    await log.append("PROPOSAL_RECEIVED", "testnet", { a: 1 });
    await log.append("PROPOSAL_RECEIVED", "testnet", { a: 2 });
    await log.append("PROPOSAL_RECEIVED", "testnet", { a: 3 });

    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    // Swap the first two lines: each entry's own hash is still internally
    // consistent with its own content, but the chain linkage breaks.
    const swapped = [lines[1], lines[0], lines[2]].join("\n") + "\n";
    writeFileSync(logPath, swapped, "utf-8");

    const result = await log.verify();
    expect(result.ok).toBe(false);
  });

  it("recovers to a valid chain once the file is restored", async () => {
    await log.append("PROPOSAL_RECEIVED", "testnet", { a: 1 });
    const original = readFileSync(logPath, "utf-8");

    writeFileSync(logPath, original.replace('"a":1', '"a":2'), "utf-8");
    expect((await log.verify()).ok).toBe(false);

    writeFileSync(logPath, original, "utf-8");
    expect((await log.verify()).ok).toBe(true);
  });
});
