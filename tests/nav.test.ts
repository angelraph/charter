import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/market/binanceRest.js", () => ({
  getAllTickerPrices: vi.fn(),
}));

import { computeApproxNavUsd, computeNavBreakdown, valueHoldings } from "../src/market/nav.js";
import { getAllTickerPrices } from "../src/market/binanceRest.js";
import type { ExecutionVenue, Balance, OrderBook, OrderRequest, OrderResult } from "../src/venues/types.js";

const mockedPrices = vi.mocked(getAllTickerPrices);

function makeVenue(balances: Balance[]): ExecutionVenue {
  return {
    name: "testnet",
    async getSubAccountBalances(): Promise<Balance[]> {
      return balances;
    },
    async getDepth(): Promise<OrderBook> {
      throw new Error("not used in this test");
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

const prices = (entries: Record<string, number>) => new Map(Object.entries(entries));

beforeEach(() => {
  mockedPrices.mockReset();
});

describe("valueHoldings", () => {
  it("is zero for an empty account", () => {
    expect(valueHoldings([], prices({})).navUsd).toBe(0);
  });

  it("counts stablecoins at one dollar, free and locked", () => {
    const r = valueHoldings(
      [
        { asset: "USDT", free: 100, locked: 0 },
        { asset: "USDC", free: 50, locked: 25 },
      ],
      prices({})
    );
    expect(r.navUsd).toBe(175);
    expect(r.priced.every((h) => h.via === "stable")).toBe(true);
  });

  it("skips zero balances", () => {
    const r = valueHoldings([{ asset: "USDT", free: 0, locked: 0 }], prices({}));
    expect(r.priced).toHaveLength(0);
    expect(r.unpriced).toHaveLength(0);
  });

  it("prices any asset through its USDT pair, not just a fixed list", () => {
    const r = valueHoldings([{ asset: "LINK", free: 10, locked: 0 }], prices({ LINKUSDT: 20 }));
    expect(r.navUsd).toBe(200);
    expect(r.priced[0]).toMatchObject({ asset: "LINK", via: "USDT" });
  });

  it("falls back to a BTC pair converted through BTCUSDT", () => {
    const r = valueHoldings([{ asset: "ODD", free: 1000, locked: 0 }], prices({ ODDBTC: 0.000001, BTCUSDT: 80000 }));
    expect(r.navUsd).toBeCloseTo(1000 * 0.000001 * 80000, 6);
    expect(r.priced[0]!.via).toBe("BTC");
  });

  it("tries ETH then BNB bridges when there is no BTC pair", () => {
    const viaEth = valueHoldings([{ asset: "ODD", free: 10, locked: 0 }], prices({ ODDETH: 0.01, ETHUSDT: 3000 }));
    expect(viaEth.priced[0]!.via).toBe("ETH");
    const viaBnb = valueHoldings([{ asset: "ODD", free: 10, locked: 0 }], prices({ ODDBNB: 0.1, BNBUSDT: 600 }));
    expect(viaBnb.priced[0]!.via).toBe("BNB");
  });

  it("prefers the direct USDT pair over a bridge", () => {
    const r = valueHoldings([{ asset: "X", free: 1, locked: 0 }], prices({ XUSDT: 5, XBTC: 1, BTCUSDT: 80000 }));
    expect(r.priced[0]).toMatchObject({ usd: 5, via: "USDT" });
  });

  it("prices a fiat currency through the inverse pair, where USDT is the base", () => {
    const r = valueHoldings([{ asset: "TRY", free: 4000, locked: 0 }], prices({ USDTTRY: 40 }));
    expect(r.navUsd).toBe(100);
    expect(r.priced[0]!.via).toBe("1/USDT");
  });

  it("reports what it cannot price instead of hiding it", () => {
    const r = valueHoldings([{ asset: "NOPAIR", free: 999, locked: 1 }], prices({}));
    expect(r.navUsd).toBe(0);
    expect(r.unpriced).toEqual([{ asset: "NOPAIR", quantity: 1000 }]);
  });

  it("does not bridge through a pair whose bridge asset has no dollar price", () => {
    const r = valueHoldings([{ asset: "ODD", free: 1, locked: 0 }], prices({ ODDBTC: 0.5 }));
    expect(r.unpriced.map((u) => u.asset)).toEqual(["ODD"]);
  });

  it("values a realistic mixed portfolio", () => {
    const r = valueHoldings(
      [
        { asset: "USDT", free: 100, locked: 0 },
        { asset: "BTC", free: 0.1, locked: 0 },
        { asset: "LINK", free: 5, locked: 0 },
        { asset: "GHOST", free: 7, locked: 0 },
      ],
      prices({ BTCUSDT: 80000, LINKUSDT: 20 })
    );
    expect(r.navUsd).toBe(100 + 0.1 * 80000 + 5 * 20);
    expect(r.unpriced).toHaveLength(1);
  });
});

describe("computeNavBreakdown and computeApproxNavUsd", () => {
  it("fetches all prices once rather than once per asset", async () => {
    mockedPrices.mockResolvedValue(prices({ BTCUSDT: 80000, ETHUSDT: 3000, LINKUSDT: 20 }));
    const venue = makeVenue([
      { asset: "BTC", free: 1, locked: 0 },
      { asset: "ETH", free: 1, locked: 0 },
      { asset: "LINK", free: 1, locked: 0 },
    ]);
    const nav = await computeApproxNavUsd(venue, "https://example.test");
    expect(nav).toBe(80000 + 3000 + 20);
    expect(mockedPrices).toHaveBeenCalledTimes(1);
    expect(mockedPrices).toHaveBeenCalledWith("https://example.test");
  });

  it("exposes the unpriced holdings", async () => {
    mockedPrices.mockResolvedValue(prices({}));
    const breakdown = await computeNavBreakdown(makeVenue([{ asset: "GHOST", free: 3, locked: 0 }]), "https://example.test");
    expect(breakdown.unpriced).toEqual([{ asset: "GHOST", quantity: 3 }]);
  });
});
