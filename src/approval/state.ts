import type { AuditEntry } from "../audit/log.js";
import type { Proposal, Verdict } from "../policy/types.js";

/**
 * Approval and kill-switch state is derived from the audit log rather than
 * kept in a separate store, the same way the rolling daily spend is. The
 * log is the single source of truth, so state can never disagree with the
 * record of what actually happened.
 */

export type ApprovalStatus = "pending" | "granted" | "rejected" | "expired";

export interface ApprovalRecord {
  approvalId: string;
  proposal: Proposal;
  verdict: Verdict;
  requestedAt: string;
  expiresAt: string;
  status: ApprovalStatus;
  resolvedAt?: string;
  resolvedBy?: string;
  note?: string;
}

interface RequestedPayload {
  approvalId: string;
  proposal: Proposal;
  verdict: Verdict;
  expiresAt: string;
}

interface ResolvedPayload {
  approvalId: string;
  approver?: string;
  note?: string;
}

export function deriveApprovals(entries: AuditEntry[], now: Date = new Date()): Map<string, ApprovalRecord> {
  const records = new Map<string, ApprovalRecord>();

  for (const e of entries) {
    if (e.type === "APPROVAL_REQUESTED") {
      const p = e.payload as RequestedPayload;
      records.set(p.approvalId, {
        approvalId: p.approvalId,
        proposal: p.proposal,
        verdict: p.verdict,
        requestedAt: e.timestamp,
        expiresAt: p.expiresAt,
        status: "pending",
      });
      continue;
    }

    const resolution: ApprovalStatus | undefined =
      e.type === "APPROVAL_GRANTED" ? "granted" : e.type === "APPROVAL_REJECTED" ? "rejected" : e.type === "APPROVAL_EXPIRED" ? "expired" : undefined;
    if (!resolution) continue;

    const p = e.payload as ResolvedPayload;
    const record = records.get(p.approvalId);
    if (!record || record.status !== "pending") continue;
    record.status = resolution;
    record.resolvedAt = e.timestamp;
    record.resolvedBy = p.approver;
    record.note = p.note;
  }

  // An approval nobody acted on before its deadline is expired, whether or
  // not anyone has yet logged that fact.
  for (const record of records.values()) {
    if (record.status === "pending" && new Date(record.expiresAt).getTime() <= now.getTime()) {
      record.status = "expired";
    }
  }

  return records;
}

export interface KillSwitchState {
  engaged: boolean;
  since?: string;
  reason?: string;
  by?: string;
}

export function deriveKillSwitch(entries: AuditEntry[]): KillSwitchState {
  let state: KillSwitchState = { engaged: false };
  for (const e of entries) {
    if (e.type === "KILL_SWITCH_ENGAGED") {
      const p = e.payload as { reason?: string; by?: string };
      state = { engaged: true, since: e.timestamp, reason: p.reason, by: p.by };
    } else if (e.type === "KILL_SWITCH_RELEASED") {
      state = { engaged: false };
    }
  }
  return state;
}
