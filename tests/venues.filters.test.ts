import { describe, it, expect } from "vitest";
import { decimalsOf, parseFilters, roundDownToStep } from "../src/venues/filters.js";
import { baseAssetOf } from "../src/market/symbols.js";

describe("decimalsOf", () => {
  it("counts the meaningful decimals of a step", () => {
    expect(decimalsOf("0.00001000")).toBe(5);
    expect(decimalsOf("0.01000000")).toBe(2);
    expect(decimalsOf("1.00000000")).toBe(0);
    expect(decimalsOf("1")).toBe(0);
    expect(decimalsOf("0.1")).toBe(1);
  });
});

describe("roundDownToStep", () => {
  it("rounds down to a multiple of the step", () => {
    expect(roundDownToStep(0.123456789, "0.00001000")).toBe(0.12345);
    expect(roundDownToStep(1.999, "0.01000000")).toBe(1.99);
  });

  it("never rounds up", () => {
    expect(roundDownToStep(0.00019999, "0.00001000")).toBe(0.00019);
  });

  it("leaves an already-valid value alone, despite floating point noise", () => {
    expect(roundDownToStep(0.3, "0.1")).toBe(0.3);
    expect(roundDownToStep(0.00018, "0.00001000")).toBe(0.00018);
    expect(roundDownToStep(79980.01, "0.01000000")).toBe(79980.01);
  });

  it("handles whole-number steps", () => {
    expect(roundDownToStep(12.9, "1.00000000")).toBe(12);
  });

  it("returns the value unchanged when the step is unusable", () => {
    expect(roundDownToStep(1.23456, "0")).toBe(1.23456);
  });

  it("can round to zero, which the caller must treat as below the minimum", () => {
    expect(roundDownToStep(0.000001, "0.00001000")).toBe(0);
  });
});

describe("parseFilters", () => {
  it("reads the lot size, tick size, and minimum notional", () => {
    const f = parseFilters([
      { filterType: "PRICE_FILTER", tickSize: "0.01000000" },
      { filterType: "LOT_SIZE", stepSize: "0.00001000", minQty: "0.00001000" },
      { filterType: "NOTIONAL", minNotional: "5.00000000" },
    ]);
    expect(f).toEqual({ stepSize: "0.00001000", tickSize: "0.01000000", minQty: 0.00001, minNotional: 5 });
  });

  it("accepts the older MIN_NOTIONAL name", () => {
    expect(parseFilters([{ filterType: "MIN_NOTIONAL", minNotional: "10" }]).minNotional).toBe(10);
  });

  it("falls back to permissive values when filters are missing", () => {
    expect(parseFilters([])).toEqual({ stepSize: "0", tickSize: "0", minQty: 0, minNotional: 0 });
  });
});

describe("baseAssetOf", () => {
  it("splits common pairs", () => {
    expect(baseAssetOf("BTCUSDT")).toBe("BTC");
    expect(baseAssetOf("ETHUSDC")).toBe("ETH");
    expect(baseAssetOf("SOLBTC")).toBe("SOL");
    expect(baseAssetOf("BNBFDUSD")).toBe("BNB");
  });

  it("does not read USDT as USD plus a stray letter", () => {
    expect(baseAssetOf("LINKUSDT")).toBe("LINK");
  });

  it("is case-insensitive", () => {
    expect(baseAssetOf("btcusdt")).toBe("BTC");
  });

  it("returns undefined for something it does not recognise, or a bare quote asset", () => {
    expect(baseAssetOf("WEIRD")).toBeUndefined();
    expect(baseAssetOf("USDT")).toBeUndefined();
  });
});
