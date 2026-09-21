import { describe, it, expect } from "vitest";
import { checkLimitPrice, checkOpenOrders, checkSellWithinHoldings } from "../src/policy/rules/orders.js";
import type { Mandate } from "../src/mandate/schema.js";
import type { Proposal, SimulationResult } from "../src/policy/types.js";

function mandate(limits: Partial<Mandate["limits"]> = {}): Mandate {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    version: 1,
    owner: "t",
    createdAt: new Date().toISOString(),
    subAccountId: "t",
    naturalLanguageSource: "t",
    status: "active",
    limits: { perTradeMaxUsd: 500, dailySpendCapUsd: 5000, maxLeverage: 1, dailyDrawdownHaltPct: 5, confirmAboveUsd: 400, ...limits },
  };
}

const proposal = (over: Partial<Proposal> = {}): Proposal =>
  ({ id: "p", agentId: "a", mandateId: "m", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quoteOrderQty: 100, submittedAt: "t", ...over }) as Proposal;

const sim = (over: Partial<SimulationResult> = {}): SimulationResult => ({ referencePrice: 100, notionalUsd: 100, ...over }) as SimulationResult;

describe("checkLimitPrice", () => {
  it("does not apply to a market order", () => {
    expect(checkLimitPrice(proposal(), mandate(), sim()).outcome).toBe("ok");
  });

  it("allows a limit price near the market", () => {
    expect(checkLimitPrice(proposal({ type: "LIMIT", limitPrice: 101, quantity: 1 }), mandate(), sim()).outcome).toBe("ok");
  });

  it("refuses a price far below the market as a likely typo", () => {
    const r = checkLimitPrice(proposal({ type: "LIMIT", limitPrice: 50, quantity: 1 }), mandate(), sim());
    expect(r.outcome).toBe("violated");
    expect(r.detail).toContain("50.00%");
  });

  it("refuses a price far above the market too", () => {
    expect(checkLimitPrice(proposal({ type: "LIMIT", limitPrice: 150, quantity: 1 }), mandate(), sim()).outcome).toBe("violated");
  });

  it("defaults to five percent", () => {
    expect(checkLimitPrice(proposal({ type: "LIMIT", limitPrice: 105, quantity: 1 }), mandate(), sim()).outcome).toBe("ok");
    expect(checkLimitPrice(proposal({ type: "LIMIT", limitPrice: 106, quantity: 1 }), mandate(), sim()).outcome).toBe("violated");
  });

  it("uses the mandate's own limit when set", () => {
    expect(checkLimitPrice(proposal({ type: "LIMIT", limitPrice: 108, quantity: 1 }), mandate({ maxLimitDeviationPct: 10 }), sim()).outcome).toBe("ok");
    expect(checkLimitPrice(proposal({ type: "LIMIT", limitPrice: 108, quantity: 1 }), mandate({ maxLimitDeviationPct: 2 }), sim()).outcome).toBe("violated");
  });
});

describe("checkOpenOrders", () => {
  const limitProposal = proposal({ type: "LIMIT", limitPrice: 100, quantity: 1 });

  it("does nothing without a limit, or for a market order", () => {
    expect(checkOpenOrders(limitProposal, mandate(), 99).outcome).toBe("ok");
    expect(checkOpenOrders(proposal(), mandate({ maxOpenOrders: 1 }), 99).outcome).toBe("ok");
  });

  it("allows a new order under the limit", () => {
    expect(checkOpenOrders(limitProposal, mandate({ maxOpenOrders: 3 }), 2).outcome).toBe("ok");
  });

  it("vetoes once the limit is reached", () => {
    expect(checkOpenOrders(limitProposal, mandate({ maxOpenOrders: 3 }), 3).outcome).toBe("violated");
  });

  it("fails closed when the open orders could not be read", () => {
    expect(checkOpenOrders(limitProposal, mandate({ maxOpenOrders: 3 }), undefined).outcome).toBe("violated");
  });
});

describe("checkSellWithinHoldings", () => {
  const sell = (over: Partial<Proposal> = {}) => proposal({ side: "SELL", ...over });

  it("does not apply to a buy", () => {
    expect(checkSellWithinHoldings(proposal(), sim(), undefined).outcome).toBe("ok");
  });

  it("allows a sell covered by what is held, sized by notional", () => {
    expect(checkSellWithinHoldings(sell(), sim({ notionalUsd: 100, referencePrice: 100 }), { BTC: 2 }).outcome).toBe("ok");
  });

  it("vetoes a sell larger than what is held", () => {
    const r = checkSellWithinHoldings(sell(), sim({ notionalUsd: 1000, referencePrice: 100 }), { BTC: 2 });
    expect(r.outcome).toBe("violated");
    expect(r.detail).toContain("BTC");
  });

  it("uses the explicit quantity for a limit sell", () => {
    expect(checkSellWithinHoldings(sell({ type: "LIMIT", quantity: 3, limitPrice: 100 }), sim(), { BTC: 2 }).outcome).toBe("violated");
    expect(checkSellWithinHoldings(sell({ type: "LIMIT", quantity: 1.5, limitPrice: 100 }), sim(), { BTC: 2 }).outcome).toBe("ok");
  });

  it("vetoes selling an asset that is not held at all", () => {
    expect(checkSellWithinHoldings(sell(), sim(), { ETH: 5 }).outcome).toBe("violated");
  });

  it("fails closed when holdings could not be read", () => {
    expect(checkSellWithinHoldings(sell(), sim(), undefined).outcome).toBe("violated");
  });

  it("fails closed when the asset cannot be worked out from the symbol", () => {
    expect(checkSellWithinHoldings(sell({ symbol: "WEIRD" }), sim(), { WEIRD: 1 }).outcome).toBe("violated");
  });
});
