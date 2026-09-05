import { describe, it, expect } from "vitest";
import { simulateProposal } from "../src/market/simulator.js";
import type { ExecutionVenue, OrderBook, Balance, OrderRequest, OrderResult } from "../src/venues/types.js";
import type { Proposal } from "../src/policy/types.js";

function makeVenue(depth: Partial<OrderBook>): ExecutionVenue {
  const fullDepth: OrderBook = {
    symbol: "BTCUSDT",
    bids: [],
    asks: [],
    sampledAt: new Date().toISOString(),
    ...depth,
  };
  return {
    name: "testnet",
    async getSubAccountBalances(): Promise<Balance[]> {
      return [];
    },
    async getDepth(): Promise<OrderBook> {
      return fullDepth;
    },
    async placeOrder(_order: OrderRequest): Promise<OrderResult> {
      throw new Error("not used in this test");
    },
    async getOrder(): Promise<OrderResult> {
      throw new Error("not used in this test");
    },
  };
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "00000000-0000-0000-0000-000000000002",
    agentId: "test-agent",
    mandateId: "00000000-0000-0000-0000-000000000001",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "MARKET",
    quoteOrderQty: 15,
    submittedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("simulateProposal", () => {
  it("fills entirely within a single level with zero slippage", async () => {
    const venue = makeVenue({ asks: [{ price: 100, quantity: 10 }] }); // $1000 available
    const result = await simulateProposal(venue, makeProposal({ quoteOrderQty: 50 }), 10000);
    expect(result.referencePrice).toBe(100);
    expect(result.projectedFillPrice).toBe(100);
    expect(result.projectedSlippageBps).toBe(0);
    expect(result.liquidityInsufficient).toBe(false);
    expect(result.unfilledUsd).toBe(0);
  });

  it("walks multiple levels and computes the volume-weighted average price", async () => {
    // Level 1: $100 x 1 = $100 notional. Level 2: $110 x 1 = $110 notional.
    const venue = makeVenue({
      asks: [
        { price: 100, quantity: 1 },
        { price: 110, quantity: 1 },
      ],
    });
    // Requesting $150: $100 fully consumes level 1, remaining $50 comes from level 2 at $110.
    const result = await simulateProposal(venue, makeProposal({ quoteOrderQty: 150 }), 10000);
    const expectedBaseQty = 100 / 100 + 50 / 110;
    const expectedAvgPrice = 150 / expectedBaseQty;
    expect(result.projectedFillPrice).toBeCloseTo(expectedAvgPrice, 6);
    expect(result.projectedSlippageBps).toBeGreaterThan(0);
    expect(result.liquidityInsufficient).toBe(false);
  });

  it("walks bids for a SELL proposal", async () => {
    const venue = makeVenue({ bids: [{ price: 90, quantity: 10 }] });
    const result = await simulateProposal(venue, makeProposal({ side: "SELL", quoteOrderQty: 50 }), 10000);
    expect(result.referencePrice).toBe(90);
    expect(result.projectedFillPrice).toBe(90);
  });

  it("throws when the relevant side has no liquidity", async () => {
    const venue = makeVenue({ asks: [] });
    await expect(simulateProposal(venue, makeProposal({ side: "BUY" }), 10000)).rejects.toThrow("No ask liquidity available");
  });

  it("throws when the bid side has no liquidity for a SELL", async () => {
    const venue = makeVenue({ bids: [], asks: [{ price: 100, quantity: 1 }] });
    await expect(simulateProposal(venue, makeProposal({ side: "SELL" }), 10000)).rejects.toThrow("No bid liquidity available");
  });

  it("signals insufficient liquidity when sampled depth can't cover the notional", async () => {
    const venue = makeVenue({ asks: [{ price: 100, quantity: 1 }] }); // only $100 available
    const result = await simulateProposal(venue, makeProposal({ quoteOrderQty: 500 }), 10000);
    expect(result.liquidityInsufficient).toBe(true);
    expect(result.unfilledUsd).toBeCloseTo(400, 6);
  });

  it("handles a zero notional without throwing", async () => {
    const venue = makeVenue({ asks: [{ price: 100, quantity: 1 }] });
    const result = await simulateProposal(venue, makeProposal({ quoteOrderQty: undefined, quantity: undefined }), 10000);
    expect(result.notionalUsd).toBe(0);
    expect(result.liquidityInsufficient).toBe(false);
  });

  it("returns zero NAV impact when navUsd is zero", async () => {
    const venue = makeVenue({ asks: [{ price: 100, quantity: 1 }] });
    const result = await simulateProposal(venue, makeProposal({ quoteOrderQty: 50 }), 0);
    expect(result.projectedNavImpactPct).toBe(0);
  });
});
