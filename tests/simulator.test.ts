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
    async getOpenOrders() {
      return [];
    },
    async cancelOrder(): Promise<OrderResult> {
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

describe("simulateProposal with LIMIT orders", () => {
  const limitBuy = (limitPrice: number, quantity: number) => makeProposal({ type: "LIMIT", limitPrice, quantity, quoteOrderQty: undefined });

  it("a limit BUY below the best ask rests entirely, with nothing filled at once", async () => {
    const venue = makeVenue({ asks: [{ price: 100, quantity: 10 }] });
    const r = await simulateProposal(venue, limitBuy(95, 2), 10000);
    expect(r.notionalUsd).toBe(190);
    expect(r.restingUsd).toBe(190);
    expect(r.projectedFillPrice).toBe(95);
    expect(r.projectedSlippageBps).toBe(0);
    expect(r.liquidityInsufficient).toBe(false);
  });

  it("a marketable limit BUY fills at the touch and rests nothing", async () => {
    const venue = makeVenue({ asks: [{ price: 100, quantity: 10 }] });
    const r = await simulateProposal(venue, limitBuy(101, 1), 10000);
    expect(r.projectedFillPrice).toBe(100);
    expect(r.restingUsd).toBe(0);
  });

  it("only takes levels at or inside the limit, and rests the remainder", async () => {
    const venue = makeVenue({
      asks: [
        { price: 100, quantity: 1 },
        { price: 105, quantity: 1 },
        { price: 120, quantity: 5 },
      ],
    });
    // Limit 106 for 3 units: can take the 100 and 105 levels ($205), 1 unit remains at 106.
    const r = await simulateProposal(venue, limitBuy(106, 3), 10000);
    expect(r.notionalUsd).toBeCloseTo(318, 6);
    expect(r.restingUsd).toBeCloseTo(106, 6); // the one unit left, valued at the limit price
    expect(r.projectedFillPrice).toBeCloseTo(102.5, 6);
    expect(r.liquidityInsufficient).toBe(false);
  });

  it("never fills more units than asked for, even when the book is cheaper than the limit", async () => {
    // A dollar budget of 3 x 106 = $318 would buy 3.18 units at $100. The order is for exactly 3.
    const venue = makeVenue({ asks: [{ price: 100, quantity: 10 }] });
    const r = await simulateProposal(venue, limitBuy(106, 3), 10000);
    expect(r.projectedFillPrice).toBe(100);
    expect(r.restingUsd).toBe(0);
    expect(r.liquidityInsufficient).toBe(false);
  });

  it("rests the unfilled units when the reachable book is too thin", async () => {
    const venue = makeVenue({ asks: [{ price: 100, quantity: 1 }] });
    const r = await simulateProposal(venue, limitBuy(101, 4), 10000);
    expect(r.restingUsd).toBe(3 * 101);
    expect(r.liquidityInsufficient).toBe(false);
  });

  it("a limit SELL above the best bid rests", async () => {
    const venue = makeVenue({ bids: [{ price: 100, quantity: 10 }] });
    const r = await simulateProposal(venue, makeProposal({ side: "SELL", type: "LIMIT", limitPrice: 110, quantity: 1, quoteOrderQty: undefined }), 10000);
    expect(r.restingUsd).toBe(110);
    expect(r.projectedFillPrice).toBe(110);
  });

  it("a marketable limit SELL walks bids at or above the limit", async () => {
    const venue = makeVenue({
      bids: [
        { price: 100, quantity: 1 },
        { price: 90, quantity: 5 },
      ],
    });
    const r = await simulateProposal(venue, makeProposal({ side: "SELL", type: "LIMIT", limitPrice: 95, quantity: 2, quoteOrderQty: undefined }), 10000);
    // Takes the 100 level (1 unit, $100); the other unit ($95) rests.
    expect(r.projectedFillPrice).toBe(100);
    expect(r.restingUsd).toBe(95);
  });

  it("a MARKET order reports no resting notional", async () => {
    const venue = makeVenue({ asks: [{ price: 100, quantity: 10 }] });
    const r = await simulateProposal(venue, makeProposal({ quoteOrderQty: 50 }), 10000);
    expect(r.restingUsd).toBe(0);
  });
});
