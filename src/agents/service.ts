import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { auditLog } from "../audit/log.js";
import { deriveAgents, type AgentRecord } from "./state.js";

export class AgentExistsError extends Error {
  constructor(public readonly agentId: string) {
    super(`Agent "${agentId}" is already registered and active. Revoke or rotate it instead.`);
    this.name = "AgentExistsError";
  }
}

export class AgentNotFoundError extends Error {
  constructor(public readonly agentId: string) {
    super(`No active agent named "${agentId}"`);
    this.name = "AgentNotFoundError";
  }
}

const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Compares two secrets without leaking, through timing, how much of a guess was right. */
export function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function newKey(): string {
  return `chk_${randomBytes(32).toString("base64url")}`;
}

export async function listAgents(): Promise<AgentRecord[]> {
  return [...deriveAgents(await auditLog.all()).values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
}

/** Registers an agent bound to specific mandates. Returns the key once; only its hash is stored. */
export async function registerAgent(agentId: string, mandateIds: string[], by: string): Promise<{ agentId: string; key: string; mandateIds: string[] }> {
  if (!AGENT_ID.test(agentId)) {
    throw new Error("agentId must be 1 to 64 characters: letters, digits, dot, dash, underscore, starting with a letter or digit");
  }
  if (mandateIds.length === 0) {
    throw new Error("An agent must be bound to at least one mandate");
  }
  const existing = deriveAgents(await auditLog.all()).get(agentId);
  if (existing?.status === "active") throw new AgentExistsError(agentId);

  const key = newKey();
  await auditLog.append("AGENT_REGISTERED", "n/a", { agentId, keyHash: hashKey(key), mandateIds, by });
  return { agentId, key, mandateIds };
}

export async function revokeAgent(agentId: string, by: string): Promise<void> {
  const existing = deriveAgents(await auditLog.all()).get(agentId);
  if (!existing || existing.status !== "active") throw new AgentNotFoundError(agentId);
  await auditLog.append("AGENT_REVOKED", "n/a", { agentId, by });
}

/** Issues a new key for an active agent, keeping its mandates. The old key stops working immediately. */
export async function rotateAgent(agentId: string, by: string): Promise<{ agentId: string; key: string; mandateIds: string[] }> {
  const existing = deriveAgents(await auditLog.all()).get(agentId);
  if (!existing || existing.status !== "active") throw new AgentNotFoundError(agentId);
  await auditLog.append("AGENT_REVOKED", "n/a", { agentId, by });
  return registerAgent(agentId, existing.mandateIds, by);
}

/**
 * Finds the active agent a presented key belongs to. Compares against every
 * active agent's hash in constant time per comparison, so response timing
 * does not reveal how much of a guess was right.
 */
export async function authenticateAgent(presentedKey: string | undefined): Promise<AgentRecord | undefined> {
  if (!presentedKey) return undefined;
  const presented = Buffer.from(hashKey(presentedKey), "hex");
  let match: AgentRecord | undefined;
  for (const agent of deriveAgents(await auditLog.all()).values()) {
    if (agent.status !== "active") continue;
    const stored = Buffer.from(agent.keyHash, "hex");
    if (stored.length === presented.length && timingSafeEqual(stored, presented)) match = agent;
  }
  return match;
}

/**
 * True once any agent has ever been registered, including ones since revoked.
 * The API is only open (no key needed) on an instance that has never used
 * per-agent keys. Revoking the last agent must not silently reopen it to
 * everyone, so revoked agents still count here.
 */
export async function registryInUse(): Promise<boolean> {
  return deriveAgents(await auditLog.all()).size > 0;
}
