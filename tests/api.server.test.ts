import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const cfg = vi.hoisted(() => ({
  apiKey: "agent-key" as string | undefined,
  approverKey: "approver-key" as string | undefined,
  apiPort: 0,
  approvalTtlMinutes: 10,
  mandatesDir: "unused",
}));

vi.mock("../src/config.js", () => ({ config: cfg }));
vi.mock("../src/audit/log.js", () => ({ auditLog: { tail: vi.fn(async () => []), append: vi.fn(), all: vi.fn(async () => []), verify: vi.fn() } }));
vi.mock("../src/venues/index.js", () => ({ activeVenue: { name: "testnet" }, marketDataBaseUrl: () => "x" }));
vi.mock("../src/policy/assess.js", () => ({ assessProposal: vi.fn() }));
vi.mock("../src/execution/adapter.js", () => ({ executeProposal: vi.fn() }));
vi.mock("../src/policy/runProposal.js", () => ({ runProposal: vi.fn() }));
vi.mock("../src/approval/service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/approval/service.js")>();
  return {
    ...actual,
    approve: vi.fn(),
    reject: vi.fn(),
    listApprovals: vi.fn(async () => []),
    getApproval: vi.fn(),
    engageKillSwitch: vi.fn(),
    releaseKillSwitch: vi.fn(),
    getKillSwitch: vi.fn(async () => ({ engaged: false })),
  };
});

import { startApiServer } from "../src/api/server.js";
import { runProposal } from "../src/policy/runProposal.js";
import * as service from "../src/approval/service.js";

let server: Server;
let base: string;

beforeAll(async () => {
  server = startApiServer();
  await new Promise<void>((resolve) => (server.listening ? resolve() : server.once("listening", () => resolve())));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  cfg.apiKey = "agent-key";
  cfg.approverKey = "approver-key";
  vi.mocked(runProposal).mockReset();
});

const AGENT = { "X-Charter-Api-Key": "agent-key" };
const APPROVER = { "X-Charter-Approver-Key": "approver-key", "X-Charter-Approver": "alice" };
const json = { "Content-Type": "application/json" };
const uuid = "00000000-0000-0000-0000-000000000001";
const proposeBody = JSON.stringify({ agentId: "a", mandateId: uuid, symbol: "BTCUSDT", side: "BUY", usd: 15 });

describe("agent credential", () => {
  it("rejects a proposal without the agent key", async () => {
    const res = await fetch(`${base}/propose`, { method: "POST", headers: json, body: proposeBody });
    expect(res.status).toBe(401);
  });

  it("accepts a proposal with the agent key and returns the approval when escalated", async () => {
    vi.mocked(runProposal).mockResolvedValue({
      proposal: { id: "p1" },
      verdict: { decision: "ESCALATE" },
      approval: { approvalId: "ap1", expiresAt: "later" },
    } as never);
    const res = await fetch(`${base}/propose`, { method: "POST", headers: { ...json, ...AGENT }, body: proposeBody });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approval: { approvalId: string }; execution: unknown };
    expect(body.approval.approvalId).toBe("ap1");
    expect(body.execution).toBeNull();
  });
});

describe("approver credential", () => {
  it("the agent key alone cannot approve", async () => {
    const res = await fetch(`${base}/approvals/x/approve`, { method: "POST", headers: { ...json, ...AGENT }, body: "{}" });
    expect(res.status).toBe(401);
    expect(service.approve).not.toHaveBeenCalled();
  });

  it("a wrong approver key is refused", async () => {
    const res = await fetch(`${base}/approvals/x/approve`, {
      method: "POST",
      headers: { ...json, "X-Charter-Approver-Key": "nope", "X-Charter-Approver": "alice" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("requires the approver to name themselves", async () => {
    const res = await fetch(`${base}/approvals/x/approve`, {
      method: "POST",
      headers: { ...json, "X-Charter-Approver-Key": "approver-key" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  it("is disabled entirely when no approver key is configured", async () => {
    cfg.approverKey = undefined;
    const res = await fetch(`${base}/approvals`, { headers: APPROVER });
    expect(res.status).toBe(403);
  });

  it("does not require the agent key on approver routes", async () => {
    const res = await fetch(`${base}/approvals`, { headers: APPROVER });
    expect(res.status).toBe(200);
  });

  it("passes the named approver and note through to the service", async () => {
    vi.mocked(service.approve).mockResolvedValue({ record: { status: "granted" }, verdict: {}, execution: { orderId: "1" } } as never);
    const res = await fetch(`${base}/approvals/ap1/approve`, { method: "POST", headers: { ...json, ...APPROVER }, body: JSON.stringify({ note: "ok" }) });
    expect(res.status).toBe(200);
    expect(service.approve).toHaveBeenCalledWith("ap1", "alice", "ok");
  });
});

describe("approval error mapping", () => {
  const post = () => fetch(`${base}/approvals/ap1/approve`, { method: "POST", headers: { ...json, ...APPROVER }, body: "{}" });

  it("unknown approval is a 404", async () => {
    vi.mocked(service.approve).mockRejectedValue(new service.ApprovalNotFoundError("ap1"));
    expect((await post()).status).toBe(404);
  });

  it("an already-decided approval is a 409", async () => {
    vi.mocked(service.approve).mockRejectedValue(new service.ApprovalStateError("ap1", "granted"));
    expect((await post()).status).toBe(409);
  });

  it("self-approval is a 403", async () => {
    vi.mocked(service.approve).mockRejectedValue(new service.SelfApprovalError("alice"));
    expect((await post()).status).toBe(403);
  });

  it("an approval blocked by the re-check is a 422 that carries the verdict", async () => {
    const verdict = { decision: "VETO", reasons: [{ rule: "killSwitch", outcome: "violated", detail: "halted" }] };
    vi.mocked(service.approve).mockRejectedValue(new service.ApprovalBlockedError(verdict as never));
    const res = await post();
    expect(res.status).toBe(422);
    expect(((await res.json()) as { verdict: { decision: string } }).verdict.decision).toBe("VETO");
  });
});

describe("escalation polling", () => {
  it("returns only the outcome to an agent, never the proposal detail", async () => {
    vi.mocked(service.getApproval).mockResolvedValue({
      approvalId: "ap1",
      status: "pending",
      expiresAt: "later",
      proposal: { secret: "detail" },
      verdict: { secret: "detail" },
    } as never);
    const res = await fetch(`${base}/escalations/ap1`, { headers: AGENT });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ approvalId: "ap1", status: "pending", expiresAt: "later", resolvedAt: null });
    expect(JSON.stringify(body)).not.toContain("detail");
  });
});

describe("kill switch endpoints", () => {
  it("halting needs the approver key", async () => {
    const res = await fetch(`${base}/control/halt`, { method: "POST", headers: { ...json, ...AGENT }, body: "{}" });
    expect(res.status).toBe(401);
    expect(service.engageKillSwitch).not.toHaveBeenCalled();
  });

  it("halts with the named operator and reason", async () => {
    vi.mocked(service.engageKillSwitch).mockResolvedValue({ engaged: true } as never);
    const res = await fetch(`${base}/control/halt`, { method: "POST", headers: { ...json, ...APPROVER }, body: JSON.stringify({ reason: "odd fills" }) });
    expect(res.status).toBe(200);
    expect(service.engageKillSwitch).toHaveBeenCalledWith("alice", "odd fills");
  });
});

describe("error responses", () => {
  it("malformed JSON is a clean 400 with no stack trace or file paths", async () => {
    const res = await fetch(`${base}/propose`, { method: "POST", headers: { ...json, ...AGENT }, body: "{ not json" });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text).error).toMatch(/not valid JSON/);
    expect(text).not.toContain("node_modules");
    expect(text).not.toContain("at ");
  });
});
