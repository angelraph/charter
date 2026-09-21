import { describe, it, expect } from "vitest";
import { parseCompilerOutput } from "../src/mandate/compiler.js";

const VALID = {
  perTradeMaxUsd: 300,
  dailySpendCapUsd: 3000,
  maxLeverage: 1,
  dailyDrawdownHaltPct: 5,
  confirmAboveUsd: 50,
  allowedSymbols: ["BTCUSDT", "ETHUSDT"],
  allowedSides: ["BUY"],
  maxSlippageBps: 50,
};

describe("parseCompilerOutput", () => {
  it("parses valid JSON", () => {
    const result = parseCompilerOutput(JSON.stringify(VALID));
    expect(result.perTradeMaxUsd).toBe(300);
    expect(result.confirmAboveUsd).toBe(50);
    expect(result.allowedSymbols).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("strips ```json ... ``` fences", () => {
    const wrapped = "```json\n" + JSON.stringify(VALID) + "\n```";
    const result = parseCompilerOutput(wrapped);
    expect(result.perTradeMaxUsd).toBe(300);
  });

  it("strips bare ``` ... ``` fences without a json tag", () => {
    const wrapped = "```\n" + JSON.stringify(VALID) + "\n```";
    const result = parseCompilerOutput(wrapped);
    expect(result.perTradeMaxUsd).toBe(300);
  });

  it("normalizes explicit nulls on optional fields to undefined", () => {
    const withNulls = {
      ...VALID,
      allowedSymbols: null,
      blockedSymbols: null,
      allowedSides: null,
      maxSlippageBps: null,
    };
    const result = parseCompilerOutput(JSON.stringify(withNulls));
    expect(result.allowedSymbols).toBeUndefined();
    expect(result.blockedSymbols).toBeUndefined();
    expect(result.allowedSides).toBeUndefined();
    expect(result.maxSlippageBps).toBeUndefined();
  });

  it("throws on non-JSON output", () => {
    expect(() => parseCompilerOutput("this is not json at all")).toThrow("non-JSON output");
  });

  it("throws listing the Zod issue for a schema violation", () => {
    const invalid = { ...VALID, perTradeMaxUsd: -10 };
    expect(() => parseCompilerOutput(JSON.stringify(invalid))).toThrow("failed validation");
  });

  it("throws when maxLeverage exceeds the schema's max of 125", () => {
    const invalid = { ...VALID, maxLeverage: 200 };
    expect(() => parseCompilerOutput(JSON.stringify(invalid))).toThrow("failed validation");
  });

  it("throws when confirmAboveUsd equals perTradeMaxUsd", () => {
    const invalid = { ...VALID, perTradeMaxUsd: 50, confirmAboveUsd: 50 };
    expect(() => parseCompilerOutput(JSON.stringify(invalid))).toThrow("must be less than");
  });

  it("throws when confirmAboveUsd exceeds perTradeMaxUsd", () => {
    const invalid = { ...VALID, perTradeMaxUsd: 50, confirmAboveUsd: 100 };
    expect(() => parseCompilerOutput(JSON.stringify(invalid))).toThrow("must be less than");
  });

  it("accepts confirmAboveUsd one cent below perTradeMaxUsd", () => {
    const boundary = { ...VALID, perTradeMaxUsd: 50, confirmAboveUsd: 49.99 };
    const result = parseCompilerOutput(JSON.stringify(boundary));
    expect(result.confirmAboveUsd).toBe(49.99);
  });
});

describe("parseCompilerOutput with the newer limits", () => {
  it("accepts and keeps the optional activity and order limits", () => {
    const result = parseCompilerOutput(
      JSON.stringify({ ...VALID, perSymbolDailyCapUsd: 500, maxTradesPerHour: 4, cooldownSeconds: 60, maxOpenOrders: 2, maxLimitDeviationPct: 3 })
    );
    expect(result).toMatchObject({ perSymbolDailyCapUsd: 500, maxTradesPerHour: 4, cooldownSeconds: 60, maxOpenOrders: 2, maxLimitDeviationPct: 3 });
  });

  it("treats null for them as not set", () => {
    const result = parseCompilerOutput(JSON.stringify({ ...VALID, perSymbolDailyCapUsd: null, maxTradesPerHour: null, cooldownSeconds: null, maxOpenOrders: null, maxLimitDeviationPct: null }));
    expect(result.maxTradesPerHour).toBeUndefined();
    expect(result.cooldownSeconds).toBeUndefined();
  });

  it("refuses values that make no sense", () => {
    expect(() => parseCompilerOutput(JSON.stringify({ ...VALID, maxTradesPerHour: 0 }))).toThrow("failed validation");
    expect(() => parseCompilerOutput(JSON.stringify({ ...VALID, maxTradesPerHour: 2.5 }))).toThrow("failed validation");
    expect(() => parseCompilerOutput(JSON.stringify({ ...VALID, maxLimitDeviationPct: 150 }))).toThrow("failed validation");
    expect(() => parseCompilerOutput(JSON.stringify({ ...VALID, cooldownSeconds: -5 }))).toThrow("failed validation");
  });
});
