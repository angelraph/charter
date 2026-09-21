import type { AuditEntry } from "../audit/log.js";

/**
 * Registered agents are derived from the audit log, like approvals and the
 * kill switch. Only a SHA-256 hash of each key is ever recorded, never the
 * key itself, so the log can be shared or inspected without exposing a
 * credential. The key is shown once, at registration.
 */

export type AgentStatus = "active" | "revoked";

export interface AgentRecord {
  agentId: string;
  keyHash: string;
  mandateIds: string[];
  status: AgentStatus;
  registeredAt: string;
  registeredBy: string;
  revokedAt?: string;
  revokedBy?: string;
}

interface RegisteredPayload {
  agentId: string;
  keyHash: string;
  mandateIds: string[];
  by: string;
}

interface RevokedPayload {
  agentId: string;
  by: string;
}

export function deriveAgents(entries: AuditEntry[]): Map<string, AgentRecord> {
  const agents = new Map<string, AgentRecord>();
  for (const e of entries) {
    if (e.type === "AGENT_REGISTERED") {
      const p = e.payload as RegisteredPayload;
      agents.set(p.agentId, {
        agentId: p.agentId,
        keyHash: p.keyHash,
        mandateIds: p.mandateIds,
        status: "active",
        registeredAt: e.timestamp,
        registeredBy: p.by,
      });
    } else if (e.type === "AGENT_REVOKED") {
      const p = e.payload as RevokedPayload;
      const record = agents.get(p.agentId);
      if (record && record.status === "active") {
        record.status = "revoked";
        record.revokedAt = e.timestamp;
        record.revokedBy = p.by;
      }
    }
  }
  return agents;
}
