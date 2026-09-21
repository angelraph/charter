import { userInfo } from "node:os";
import { listAgents, registerAgent, revokeAgent, rotateAgent } from "../../agents/service.js";

function operator(explicit?: string): string {
  return explicit ?? userInfo().username;
}

function printKey(action: string, agentId: string, mandateIds: string[], key: string): void {
  console.log(`${action} agent "${agentId}", bound to: ${mandateIds.join(", ")}`);
  console.log("");
  console.log(`  API key: ${key}`);
  console.log("");
  console.log("This is the only time the key is shown. Only its hash is stored, so it cannot be recovered.");
  console.log("The agent sends it as the X-Charter-Api-Key header. Its identity comes from the key, not from the request body.");
}

export async function agentAddCommand(agentId: string, mandateIds: string[], by?: string): Promise<void> {
  const { key } = await registerAgent(agentId, mandateIds, operator(by));
  printKey("Registered", agentId, mandateIds, key);
}

export async function agentRotateCommand(agentId: string, by?: string): Promise<void> {
  const { key, mandateIds } = await rotateAgent(agentId, operator(by));
  printKey("Rotated the key for", agentId, mandateIds, key);
  console.log("The previous key stopped working immediately.");
}

export async function agentRevokeCommand(agentId: string, by?: string): Promise<void> {
  await revokeAgent(agentId, operator(by));
  console.log(`Revoked "${agentId}". Its key no longer works.`);
}

export async function agentListCommand(): Promise<void> {
  const agents = await listAgents();
  if (agents.length === 0) {
    console.log("No agents registered.");
    return;
  }
  for (const a of agents) {
    const tail = a.status === "revoked" ? `  revoked ${a.revokedAt} by ${a.revokedBy}` : "";
    console.log(`${a.agentId}  ${a.status.toUpperCase()}  mandates: ${a.mandateIds.join(", ")}  registered ${a.registeredAt} by ${a.registeredBy}${tail}`);
  }
}
