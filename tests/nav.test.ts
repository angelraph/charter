import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/market/binanceRest.js", () => ({
  getTickerPrice: vi.fn(),
}));

import { computeApproxNavUsd } from "../src/market/nav.js";
import { getTickerPrice } from "../src/market/binanceRest.js";
import type { ExecutionVenue, Balance, OrderBook, OrderRequest, OrderResult } from "../src/venues/types.js";

const mockedGetTickerPrice = vi.mocked(getTickerPrice);

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
  };
}

beforeEach(() => {
  mockedGetTickerPrice.mockReset();
});

describe("computeApproxNavUsd", () => {
  it("returns 0 for empty balances", async () => {
    const nav = await computeApproxNavUsd(makeVenue([]), "https://example.test");
    expect(nav).toBe(0);
    expect(mockedGetTickerPrice).not.toHaveBeenCalled();
  });

  it("sums stables at 1:1 without calling the ticker", async () => {
    const balances: Balance[] = [
      { asset: "USDT", free: 100, locked: 0 },
      { asset: "USDC", free: 50, locked: 25 },
    ];
    const nav = await computeApproxNavUsd(makeVenue(balances), "https://example.test");
    expect(nav).toBe(175);
    expect(mockedGetTickerPrice).not.toHaveBeenCalled();
  });

  it("skips zero-balance entries", async () => {
    const balances: Balance[] = [{ asset: "USDT", free: 0, locked: 0 }];
    const nav = await computeApproxNavUsd(makeVenue(balances), "https://example.test");
    expect(nav).toBe(0);
  });

  it("converts a priced asset via its live ticker", async () => {
    mockedGetTickerPrice.mockResolvedValueOnce({ symbol: "BTCUSDT", price: 80000 });
    const balances: Balance[] = [{ asset: "BTC", free: 0.5, locked: 0 }];
    const nav = await computeApproxNavUsd(makeVenue(balances), "https://example.test");
    expect(nav).toBe(40000);
    expect(mockedGetTickerPrice).toHaveBeenCalledWith("https://example.test", "BTCUSDT");
  });

  it("silently skips an asset outside the stables and priced-asset lists", async () => {
    const balances: Balance[] = [{ asset: "SOMERANDOMCOIN", free: 1000, locked: 0 }];
    const nav = await computeApproxNavUsd(makeVenue(balances), "https://example.test");
    expect(nav).toBe(0);
    expect(mockedGetTickerPrice).not.toHaveBeenCalled();
  });

  it("excludes a priced asset whose ticker call rejects, without throwing", async () => {
    mockedGetTickerPrice.mockRejectedValueOnce(new Error("no USDT pair"));
    const balances: Balance[] = [{ asset: "ETH", free: 1, locked: 0 }];
    await expect(computeApproxNavUsd(makeVenue(balances), "https://example.test")).resolves.toBe(0);
  });

  it("computes a realistic mixed portfolio", async () => {
    mockedGetTickerPrice.mockImplementation(async (_base: string, symbol: string) => {
      if (symbol === "BTCUSDT") return { symbol, price: 80000 };
      throw new Error("unexpected symbol");
    });
    const balances: Balance[] = [
      { asset: "USDT", free: 100, locked: 0 },
      { asset: "BTC", free: 0.1, locked: 0 },
      { asset: "SOMERANDOMCOIN", free: 999, locked: 0 },
    ];
    const nav = await computeApproxNavUsd(makeVenue(balances), "https://example.test");
    expect(nav).toBe(100 + 0.1 * 80000);
  });
});
