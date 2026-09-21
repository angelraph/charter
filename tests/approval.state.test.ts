import { describe, it, expect } from "vitest";
import { deriveApprovals, deriveKillSwitch } from "../src/approval/state.js";
import type { AuditEntry, AuditEventType } from "../src/audit/log.js";
import type { Proposal, Verdict } from "../src/policy/types.js";

let seq = 0;
function entry(type: AuditEventType, payload: unknown, timestamp = new Date().toISOString()): AuditEntry {
  return { seq: seq++, timestamp, type, venue: "n/a", payload, prevHash: "x", hash: "y" };
}

const proposal = { id: "p1", agentId: "agent-a", symbol: "BTCUSDT" } as unknown as Proposal;
const verdict = { id: "v1", decision: "ESCALATE" } as unknown as Verdict;

function requested(approvalId: string, expiresAt: string): AuditEntry {
  return entry("APPROVAL_REQUESTED", { approvalId, proposal, verdict, expiresAt });
}

const future = () => new Date(Date.now() + 60_000).toISOString();
const past = () => new Date(Date.now() - 60_000).toISOString();

describe("deriveApprovals", () => {
  it("a requested approval is pending until someone decides", () => {
    const records = deriveApprovals([requested("a1", future())]);
    expect(records.get("a1")?.status).toBe("pending");
  });

  it("records who granted it", () => {
    const records = deriveApprovals([requested("a1", future()), entry("APPROVAL_GRANTED", { approvalId: "a1", approver: "alice", note: "ok" })]);
    const r = records.get("a1")!;
    expect(r.status).toBe("granted");
    expect(r.resolvedBy).toBe("alice");
    expect(r.note).toBe("ok");
  });

  it("records a rejection", () => {
    const records = deriveApprovals([requested("a1", future()), entry("APPROVAL_REJECTED", { approvalId: "a1", approver: "bob" })]);
    expect(records.get("a1")?.status).toBe("rejected");
  });

  it("treats an unresolved approval past its deadline as expired", () => {
    const records = deriveApprovals([requested("a1", past())]);
    expect(records.get("a1")?.status).toBe("expired");
  });

  it("does not let a later decision overwrite an earlier one", () => {
    const records = deriveApprovals([
      requested("a1", future()),
      entry("APPROVAL_REJECTED", { approvalId: "a1", approver: "bob" }),
      entry("APPROVAL_GRANTED", { approvalId: "a1", approver: "alice" }),
    ]);
    const r = records.get("a1")!;
    expect(r.status).toBe("rejected");
    expect(r.resolvedBy).toBe("bob");
  });

  it("ignores a decision for an approval that was never requested", () => {
    const records = deriveApprovals([entry("APPROVAL_GRANTED", { approvalId: "ghost", approver: "alice" })]);
    expect(records.size).toBe(0);
  });

  it("tracks several approvals independently", () => {
    const records = deriveApprovals([
      requested("a1", future()),
      requested("a2", future()),
      entry("APPROVAL_GRANTED", { approvalId: "a1", approver: "alice" }),
    ]);
    expect(records.get("a1")?.status).toBe("granted");
    expect(records.get("a2")?.status).toBe("pending");
  });

  it("with the clock set to the epoch, reports what was actually logged rather than derived expiry", () => {
    const records = deriveApprovals([requested("a1", past())], new Date(0));
    expect(records.get("a1")?.status).toBe("pending");
  });
});

describe("deriveKillSwitch", () => {
  it("is not engaged by default", () => {
    expect(deriveKillSwitch([]).engaged).toBe(false);
  });

  it("engages, carrying who and why", () => {
    const state = deriveKillSwitch([entry("KILL_SWITCH_ENGAGED", { by: "alice", reason: "odd fills" })]);
    expect(state.engaged).toBe(true);
    expect(state.by).toBe("alice");
    expect(state.reason).toBe("odd fills");
  });

  it("releases", () => {
    const state = deriveKillSwitch([entry("KILL_SWITCH_ENGAGED", { by: "alice" }), entry("KILL_SWITCH_RELEASED", { by: "alice" })]);
    expect(state.engaged).toBe(false);
  });

  it("the latest event wins across several toggles", () => {
    const state = deriveKillSwitch([
      entry("KILL_SWITCH_ENGAGED", { by: "a" }),
      entry("KILL_SWITCH_RELEASED", { by: "a" }),
      entry("KILL_SWITCH_ENGAGED", { by: "b", reason: "again" }),
    ]);
    expect(state.engaged).toBe(true);
    expect(state.by).toBe("b");
  });
});
