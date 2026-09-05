import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/audit/log.js", () => ({
  auditLog: { append: vi.fn() },
}));

import { executeProposal } from "../src/execution/adapter.js";
import { auditLog } from "../src/audit/log.js";
import type { ExecutionVenue, Balance, OrderBook, OrderRequest, OrderResult } from "../src/venues/types.js";
import type { Proposal, Verdict, SimulationResult } from "../src/policy/types.js";

const mockedAppend = vi.mocked(auditLog.append);

function makeProposal(): Proposal {
  return {
    id: "00000000-0000-0000-0000-000000000002",
    agentId: "test-agent",
    mandateId: "00000000-0000-0000-0000-000000000001",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "MARKET",
    quoteOrderQty: 15,
    submittedAt: new Date().toISOString(),
  };
}

function makeSimulation(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    venue: "testnet",
    referencePrice: 60000,
    projectedFillPrice: 60000,
    projectedSlippageBps: 0,
    notionalUsd: 15,
    projectedNavImpactPct: 0.01,
    orderBookDepthSampledAt: new Date().toISOString(),
    liquidityInsufficient: false,
    unfilledUsd: 0,
    ...overrides,
  };
}

function makeVerdict(decision: Verdict["decision"]): Verdict {
  return {
    id: "00000000-0000-0000-0000-000000000003",
    proposalId: "00000000-0000-0000-0000-000000000002",
    decision,
    reasons: [{ rule: "symbolAllowlist", outcome: "ok", detail: "permitted" }],
    simulation: makeSimulation(),
    decidedAt: new Date().toISOString(),
    policyVersion: 1,
  };
}

function makeVenue(overrides: Partial<ExecutionVenue> = {}): ExecutionVenue {
  return {
    name: "testnet",
    async getSubAccountBalances(): Promise<Balance[]> {
      return [];
    },
    async getDepth(): Promise<OrderBook> {
      throw new Error("not used in this test");
    },
    async placeOrder(_order: OrderRequest): Promise<OrderResult> {
      throw new Error("placeOrder not stubbed for this test");
    },
    async getOrder(): Promise<OrderResult> {
      throw new Error("not used in this test");
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockedAppend.mockReset();
  mockedAppend.mockResolvedValue({} as never);
});

describe("executeProposal", () => {
  it("refuses to execute a VETO verdict and never calls placeOrder or the audit log", async () => {
    const placeOrder = vi.fn();
    const venue = makeVenue({ placeOrder });
    await expect(executeProposal(venue, makeProposal(), makeVerdict("VETO"))).rejects.toThrow("not PASS");
    expect(placeOrder).not.toHaveBeenCalled();
    expect(mockedAppend).not.toHaveBeenCalled();
  });

  it("refuses to execute an un-actioned ESCALATE verdict", async () => {
    const placeOrder = vi.fn();
    const venue = makeVenue({ placeOrder });
    await expect(executeProposal(venue, makeProposal(), makeVerdict("ESCALATE"))).rejects.toThrow("not PASS");
    expect(placeOrder).not.toHaveBeenCalled();
    expect(mockedAppend).not.toHaveBeenCalled();
  });

  it("logs EXECUTION_ATTEMPTED then EXECUTION_FILLED on a successful PASS", async () => {
    const orderResult: OrderResult = {
      venue: "testnet",
      orderId: "12345",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      status: "FILLED",
      executedQty: 0.0002,
      cummulativeQuoteQty: 15,
      fills: [],
      raw: {},
    };
    const venue = makeVenue({ placeOrder: vi.fn().mockResolvedValue(orderResult) });

    const result = await executeProposal(venue, makeProposal(), makeVerdict("PASS"));

    expect(result).toBe(orderResult);
    expect(mockedAppend).toHaveBeenCalledTimes(2);
    expect(mockedAppend.mock.calls[0]![0]).toBe("EXECUTION_ATTEMPTED");
    expect(mockedAppend.mock.calls[1]![0]).toBe("EXECUTION_FILLED");
  });

  it("logs EXECUTION_ATTEMPTED then EXECUTION_REJECTED_BY_PLATFORM and rethrows when placeOrder fails", async () => {
    const venue = makeVenue({ placeOrder: vi.fn().mockRejectedValue(new Error("insufficient balance")) });

    await expect(executeProposal(venue, makeProposal(), makeVerdict("PASS"))).rejects.toThrow("insufficient balance");

    expect(mockedAppend).toHaveBeenCalledTimes(2);
    expect(mockedAppend.mock.calls[0]![0]).toBe("EXECUTION_ATTEMPTED");
    expect(mockedAppend.mock.calls[1]![0]).toBe("EXECUTION_REJECTED_BY_PLATFORM");
  });
});
