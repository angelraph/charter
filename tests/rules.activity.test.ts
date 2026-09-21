import { describe, it, expect } from "vitest";
import { checkCooldown, checkPerSymbolDailyCap, checkTradeRate } from "../src/policy/rules/activity.js";
import type { Mandate } from "../src/mandate/schema.js";
import type { Proposal, SimulationResult } from "../src/policy/types.js";
import type { AuditEntry, AuditEventType } from "../src/audit/log.js";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function mandate(limits: Partial<Mandate["limits"]>): Mandate {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    version: 1,
    owner: "t",
    createdAt: NOW.toISOString(),
    subAccountId: "t",
    naturalLanguageSource: "t",
    status: "active",
    limits: { perTradeMaxUsd: 500, dailySpendCapUsd: 5000, maxLeverage: 1, dailyDrawdownHaltPct: 5, confirmAboveUsd: 400, ...limits },
  };
}

const proposal = (over: Partial<Proposal> = {}): Proposal =>
  ({ id: "p", agentId: "alpha", mandateId: "m", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quoteOrderQty: 100, submittedAt: NOW.toISOString(), ...over }) as Proposal;

const sim = (notionalUsd: number): SimulationResult => ({ notionalUsd }) as SimulationResult;

let seq = 0;
function exec(type: AuditEventType, agentId: string | undefined, symbol: string, notionalUsd: number, minutesAgo: number): AuditEntry {
  return {
    seq: seq++,
    timestamp: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    type,
    venue: "testnet",
    payload: { agentId, symbol, notionalUsd },
    prevHash: "x",
    hash: "y",
  };
}

describe("checkPerSymbolDailyCap", () => {
  it("does nothing when no cap is set", () => {
    expect(checkPerSymbolDailyCap(proposal(), mandate({}), sim(100), [], NOW).outcome).toBe("ok");
  });

  it("allows a trade that keeps the symbol within its cap", () => {
    const entries = [exec("EXECUTION_FILLED", "alpha", "BTCUSDT", 100, 30)];
    expect(checkPerSymbolDailyCap(proposal(), mandate({ perSymbolDailyCapUsd: 250 }), sim(100), entries, NOW).outcome).toBe("ok");
  });

  it("vetoes a trade that would push the symbol over its cap", () => {
    const entries = [exec("EXECUTION_FILLED", "alpha", "BTCUSDT", 200, 30)];
    const r = checkPerSymbolDailyCap(proposal(), mandate({ perSymbolDailyCapUsd: 250 }), sim(100), entries, NOW);
    expect(r.outcome).toBe("violated");
    expect(r.detail).toContain("BTCUSDT");
  });

  it("counts every agent, since it is a cap on the symbol", () => {
    const entries = [exec("EXECUTION_FILLED", "someone-else", "BTCUSDT", 200, 30)];
    expect(checkPerSymbolDailyCap(proposal(), mandate({ perSymbolDailyCapUsd: 250 }), sim(100), entries, NOW).outcome).toBe("violated");
  });

  it("ignores other symbols and earlier days", () => {
    const entries = [exec("EXECUTION_FILLED", "alpha", "ETHUSDT", 900, 30), exec("EXECUTION_FILLED", "alpha", "BTCUSDT", 900, 60 * 24)];
    expect(checkPerSymbolDailyCap(proposal(), mandate({ perSymbolDailyCapUsd: 250 }), sim(100), entries, NOW).outcome).toBe("ok");
  });

  it("counts a resting placed order, because it can still fill", () => {
    const entries = [exec("EXECUTION_PLACED", "alpha", "BTCUSDT", 200, 30)];
    expect(checkPerSymbolDailyCap(proposal(), mandate({ perSymbolDailyCapUsd: 250 }), sim(100), entries, NOW).outcome).toBe("violated");
  });
});

describe("checkTradeRate", () => {
  it("does nothing when no limit is set", () => {
    expect(checkTradeRate(proposal(), mandate({}), [], NOW).outcome).toBe("ok");
  });

  it("allows an agent under its hourly limit", () => {
    const entries = [exec("EXECUTION_FILLED", "alpha", "BTCUSDT", 10, 10)];
    expect(checkTradeRate(proposal(), mandate({ maxTradesPerHour: 2 }), entries, NOW).outcome).toBe("ok");
  });

  it("vetoes an agent that has reached its hourly limit", () => {
    const entries = [exec("EXECUTION_FILLED", "alpha", "BTCUSDT", 10, 10), exec("EXECUTION_FILLED", "alpha", "ETHUSDT", 10, 20)];
    const r = checkTradeRate(proposal(), mandate({ maxTradesPerHour: 2 }), entries, NOW);
    expect(r.outcome).toBe("violated");
    expect(r.detail).toContain("alpha");
  });

  it("counts only that agent's trades", () => {
    const entries = [exec("EXECUTION_FILLED", "beta", "BTCUSDT", 10, 10), exec("EXECUTION_FILLED", "beta", "ETHUSDT", 10, 20)];
    expect(checkTradeRate(proposal(), mandate({ maxTradesPerHour: 2 }), entries, NOW).outcome).toBe("ok");
  });

  it("only looks at the last hour", () => {
    const entries = [exec("EXECUTION_FILLED", "alpha", "BTCUSDT", 10, 61), exec("EXECUTION_FILLED", "alpha", "BTCUSDT", 10, 90)];
    expect(checkTradeRate(proposal(), mandate({ maxTradesPerHour: 2 }), entries, NOW).outcome).toBe("ok");
  });

  it("ignores older entries that carry no agent id rather than crashing", () => {
    const entries = [exec("EXECUTION_FILLED", undefined, "BTCUSDT", 10, 5)];
    expect(checkTradeRate(proposal(), mandate({ maxTradesPerHour: 1 }), entries, NOW).outcome).toBe("ok");
  });
});

describe("checkCooldown", () => {
  it("does nothing when no cooldown is set", () => {
    expect(checkCooldown(proposal(), mandate({}), [exec("EXECUTION_FILLED", "alpha", "BTCUSDT", 10, 0)], NOW).outcome).toBe("ok");
  });

  it("vetoes a repeat trade inside the cooldown, and says how long is left", () => {
    const entries = [exec("EXECUTION_FILLED", "alpha", "BTCUSDT", 10, 1)];
    const r = checkCooldown(proposal(), mandate({ cooldownSeconds: 300 }), entries, NOW);
    expect(r.outcome).toBe("violated");
    expect(r.detail).toContain("left");
  });

  it("allows it once the cooldown has passed", () => {
    const entries = [exec("EXECUTION_FILLED", "alpha", "BTCUSDT", 10, 10)];
    expect(checkCooldown(proposal(), mandate({ cooldownSeconds: 300 }), entries, NOW).outcome).toBe("ok");
  });

  it("applies per agent and per symbol", () => {
    const entries = [exec("EXECUTION_FILLED", "beta", "BTCUSDT", 10, 1), exec("EXECUTION_FILLED", "alpha", "ETHUSDT", 10, 1)];
    expect(checkCooldown(proposal(), mandate({ cooldownSeconds: 300 }), entries, NOW).outcome).toBe("ok");
  });

  it("measures from the most recent trade, not the first", () => {
    const entries = [exec("EXECUTION_FILLED", "alpha", "BTCUSDT", 10, 60), exec("EXECUTION_FILLED", "alpha", "BTCUSDT", 10, 1)];
    expect(checkCooldown(proposal(), mandate({ cooldownSeconds: 300 }), entries, NOW).outcome).toBe("violated");
  });
});
