import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({
  entries: [] as Array<{ seq: number; timestamp: string; type: string; venue: string; payload: unknown; prevHash: string; hash: string }>,
}));

vi.mock("../src/audit/log.js", () => ({
  auditLog: {
    append: vi.fn(async (type: string, venue: string, payload: unknown) => {
      const e = { seq: store.entries.length, timestamp: new Date().toISOString(), type, venue, payload, prevHash: "x", hash: "y" };
      store.entries.push(e);
      return e;
    }),
    all: vi.fn(async () => [...store.entries]),
  },
}));

import {
  AgentExistsError,
  AgentNotFoundError,
  authenticateAgent,
  constantTimeEquals,
  registryInUse,
  hashKey,
  listAgents,
  registerAgent,
  revokeAgent,
  rotateAgent,
} from "../src/agents/service.js";

const M1 = "00000000-0000-0000-0000-000000000001";
const M2 = "00000000-0000-0000-0000-000000000002";

beforeEach(() => {
  store.entries.length = 0;
});

describe("registerAgent", () => {
  it("returns a key once and stores only its hash", async () => {
    const { key } = await registerAgent("alpha", [M1], "alice");
    expect(key.startsWith("chk_")).toBe(true);

    const logged = JSON.stringify(store.entries);
    expect(logged).not.toContain(key);
    expect(logged).toContain(hashKey(key));
  });

  it("issues a different key each time", async () => {
    const a = await registerAgent("alpha", [M1], "alice");
    const b = await registerAgent("beta", [M1], "alice");
    expect(a.key).not.toBe(b.key);
  });

  it("refuses to register an active agent twice", async () => {
    await registerAgent("alpha", [M1], "alice");
    await expect(registerAgent("alpha", [M1], "alice")).rejects.toBeInstanceOf(AgentExistsError);
  });

  it("refuses an agent bound to no mandate", async () => {
    await expect(registerAgent("alpha", [], "alice")).rejects.toThrow("at least one mandate");
  });

  it("refuses an unsafe or empty agent id", async () => {
    await expect(registerAgent("", [M1], "alice")).rejects.toThrow();
    await expect(registerAgent("has space", [M1], "alice")).rejects.toThrow();
    await expect(registerAgent("../etc", [M1], "alice")).rejects.toThrow();
  });

  it("allows registering again once the agent has been revoked", async () => {
    await registerAgent("alpha", [M1], "alice");
    await revokeAgent("alpha", "alice");
    await expect(registerAgent("alpha", [M2], "alice")).resolves.toBeDefined();
  });
});

describe("authenticateAgent", () => {
  it("identifies the agent a key belongs to, with its mandates", async () => {
    const { key } = await registerAgent("alpha", [M1, M2], "alice");
    const agent = await authenticateAgent(key);
    expect(agent?.agentId).toBe("alpha");
    expect(agent?.mandateIds).toEqual([M1, M2]);
  });

  it("does not confuse two agents' keys", async () => {
    const a = await registerAgent("alpha", [M1], "alice");
    const b = await registerAgent("beta", [M2], "alice");
    expect((await authenticateAgent(a.key))?.agentId).toBe("alpha");
    expect((await authenticateAgent(b.key))?.agentId).toBe("beta");
  });

  it("rejects an unknown, empty, or missing key", async () => {
    await registerAgent("alpha", [M1], "alice");
    expect(await authenticateAgent("chk_wrong")).toBeUndefined();
    expect(await authenticateAgent("")).toBeUndefined();
    expect(await authenticateAgent(undefined)).toBeUndefined();
  });

  it("rejects a revoked agent's key", async () => {
    const { key } = await registerAgent("alpha", [M1], "alice");
    await revokeAgent("alpha", "alice");
    expect(await authenticateAgent(key)).toBeUndefined();
  });
});

describe("rotateAgent", () => {
  it("invalidates the old key immediately and keeps the mandates", async () => {
    const first = await registerAgent("alpha", [M1, M2], "alice");
    const second = await rotateAgent("alpha", "alice");

    expect(await authenticateAgent(first.key)).toBeUndefined();
    const agent = await authenticateAgent(second.key);
    expect(agent?.agentId).toBe("alpha");
    expect(agent?.mandateIds).toEqual([M1, M2]);
  });

  it("cannot rotate an agent that does not exist or is revoked", async () => {
    await expect(rotateAgent("ghost", "alice")).rejects.toBeInstanceOf(AgentNotFoundError);
    await registerAgent("alpha", [M1], "alice");
    await revokeAgent("alpha", "alice");
    await expect(rotateAgent("alpha", "alice")).rejects.toBeInstanceOf(AgentNotFoundError);
  });
});

describe("revokeAgent, listAgents, registryInUse", () => {
  it("revoking an unknown agent is an error", async () => {
    await expect(revokeAgent("ghost", "alice")).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  it("records who registered and who revoked", async () => {
    await registerAgent("alpha", [M1], "alice");
    await revokeAgent("alpha", "bob");
    const [agent] = await listAgents();
    expect(agent).toMatchObject({ agentId: "alpha", status: "revoked", registeredBy: "alice", revokedBy: "bob" });
  });

  it("registryInUse stays true after the last agent is revoked, so the API does not reopen", async () => {
    expect(await registryInUse()).toBe(false);
    await registerAgent("alpha", [M1], "alice");
    expect(await registryInUse()).toBe(true);
    await revokeAgent("alpha", "alice");
    expect(await registryInUse()).toBe(true);
  });
});

describe("constantTimeEquals", () => {
  it("compares correctly", () => {
    expect(constantTimeEquals("same", "same")).toBe(true);
    expect(constantTimeEquals("same", "diff")).toBe(false);
    expect(constantTimeEquals("short", "a much longer value")).toBe(false);
  });
});
