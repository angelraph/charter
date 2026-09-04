import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export type AuditEventType =
  | "MANDATE_CREATED"
  | "MANDATE_UPDATED"
  | "NAV_SNAPSHOT"
  | "PROPOSAL_RECEIVED"
  | "VERDICT_ISSUED"
  | "EXECUTION_ATTEMPTED"
  | "EXECUTION_CONFIRMED"
  | "EXECUTION_FILLED"
  | "EXECUTION_REJECTED_BY_PLATFORM";

export interface AuditEntry {
  seq: number;
  timestamp: string;
  type: AuditEventType;
  venue: "testnet" | "mainnet-mcp" | "n/a";
  payload: unknown;
  prevHash: string;
  hash: string;
}

const GENESIS = "GENESIS";

function hashEntry(e: Omit<AuditEntry, "hash">): string {
  const canonical = JSON.stringify({
    seq: e.seq,
    timestamp: e.timestamp,
    type: e.type,
    venue: e.venue,
    payload: e.payload,
    prevHash: e.prevHash,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Append-only, hash-chained audit log. One JSON object per line. Every
 * entry's hash depends on the previous entry's hash, so any tampering
 * with an earlier line breaks the chain from that point forward,
 * verifiable with `verify()` below.
 */
export class AuditLog {
  private readonly filePath: string;

  constructor(filePath: string = config.auditLogPath) {
    this.filePath = filePath;
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private async readAll(): Promise<AuditEntry[]> {
    if (!existsSync(this.filePath)) return [];
    const content = await readFile(this.filePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AuditEntry);
  }

  async append(type: AuditEventType, venue: AuditEntry["venue"], payload: unknown): Promise<AuditEntry> {
    const entries = await this.readAll();
    const last = entries[entries.length - 1];
    const seq = last ? last.seq + 1 : 0;
    const prevHash = last ? last.hash : GENESIS;
    const timestamp = new Date().toISOString();

    const withoutHash = { seq, timestamp, type, venue, payload, prevHash };
    const hash = hashEntry(withoutHash);
    const entry: AuditEntry = { ...withoutHash, hash };

    // Single-writer append with fsync so a crash mid-write can't corrupt prior lines.
    const fh = await open(this.filePath, "a");
    try {
      await fh.appendFile(JSON.stringify(entry) + "\n", "utf-8");
      await fh.sync();
    } finally {
      await fh.close();
    }

    return entry;
  }

  async tail(n = 20): Promise<AuditEntry[]> {
    const entries = await this.readAll();
    return entries.slice(-n);
  }

  async all(): Promise<AuditEntry[]> {
    return this.readAll();
  }

  /** Verifies the hash chain end to end. Returns the first break, if any. */
  async verify(): Promise<{ ok: true } | { ok: false; brokenAtSeq: number; reason: string }> {
    const entries = await this.readAll();
    let expectedPrevHash = GENESIS;
    for (const entry of entries) {
      if (entry.prevHash !== expectedPrevHash) {
        return { ok: false, brokenAtSeq: entry.seq, reason: `prevHash mismatch: expected ${expectedPrevHash}, got ${entry.prevHash}` };
      }
      const recomputed = hashEntry({
        seq: entry.seq,
        timestamp: entry.timestamp,
        type: entry.type,
        venue: entry.venue,
        payload: entry.payload,
        prevHash: entry.prevHash,
      });
      if (recomputed !== entry.hash) {
        return { ok: false, brokenAtSeq: entry.seq, reason: `hash mismatch: entry content does not match its recorded hash` };
      }
      expectedPrevHash = entry.hash;
    }
    return { ok: true };
  }
}

export const auditLog = new AuditLog();
