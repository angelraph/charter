import { describe, it, expect } from "vitest";
import { evaluateProposal } from "../src/policy/engine.js";
import type { Mandate } from "../src/mandate/schema.js";
import type { Proposal, SimulationResult } from "../src/policy/types.js";
import type { AuditEntry } from "../src/audit/log.js";

function makeMandate(overrides: Partial<Mandate["limits"]> = {}): Mandate {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    version: 1,
    owner: "test",
    createdAt: new Date().toISOString(),
    subAccountId: "test-account",
    naturalLanguageSource: "test mandate",
    status: "active",
    limits: {
      perTradeMaxUsd: 50,
      dailySpendCapUsd: 500,
      maxLeverage: 1,
      dailyDrawdownHaltPct: 5,
      confirmAboveUsd: 200,
      allowedSymbols: ["BTCUSDT", "ETHUSDT"],
      allowedSides: ["BUY"],
      maxSlippageBps: 50,
      ...overrides,
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
    restingUsd: 0,
    ...overrides,
  };
}

const noFills: AuditEntry[] = [];
const flatNav = { currentNavUsd: 10000, startOfDayNavUsd: 10000 };

describe("evaluateProposal", () => {
  it("passes a compliant proposal", () => {
    const verdict = evaluateProposal(makeProposal(), makeMandate(), makeSimulation(), noFills, flatNav);
    expect(verdict.decision).toBe("PASS");
    expect(verdict.reasons.every((r) => r.outcome === "ok")).toBe(true);
  });

  it("vetoes a proposal that exceeds perTradeMaxUsd", () => {
    const simulation = makeSimulation({ notionalUsd: 500 });
    const verdict = evaluateProposal(makeProposal({ quoteOrderQty: 500 }), makeMandate(), simulation, noFills, flatNav);
    expect(verdict.decision).toBe("VETO");
    expect(verdict.reasons.some((r) => r.rule === "perTradeMaxUsd" && r.outcome === "violated")).toBe(true);
  });

  it("vetoes a symbol outside the allowlist", () => {
    const verdict = evaluateProposal(makeProposal({ symbol: "DOGEUSDT" }), makeMandate(), makeSimulation(), noFills, flatNav);
    expect(verdict.decision).toBe("VETO");
    expect(verdict.reasons.some((r) => r.rule === "symbolAllowlist" && r.outcome === "violated")).toBe(true);
  });

  it("vetoes a disallowed side", () => {
    const verdict = evaluateProposal(makeProposal({ side: "SELL" }), makeMandate(), makeSimulation(), noFills, flatNav);
    expect(verdict.decision).toBe("VETO");
    expect(verdict.reasons.some((r) => r.rule === "symbolAllowlist" && r.outcome === "violated")).toBe(true);
  });

  it("escalates a proposal above confirmAboveUsd without violating other rules", () => {
    const mandate = makeMandate({ perTradeMaxUsd: 300, dailySpendCapUsd: 1000 });
    const simulation = makeSimulation({ notionalUsd: 250 });
    const verdict = evaluateProposal(makeProposal({ quoteOrderQty: 250 }), mandate, simulation, noFills, flatNav);
    expect(verdict.decision).toBe("ESCALATE");
  });

  it("vetoes when today's rolling spend plus this proposal exceeds the daily cap", () => {
    const mandate = makeMandate({ dailySpendCapUsd: 100 });
    const todaysFills: AuditEntry[] = [
      {
        seq: 0,
        timestamp: new Date().toISOString(),
        type: "EXECUTION_FILLED",
        venue: "testnet",
        payload: { notionalUsd: 90 },
        prevHash: "GENESIS",
        hash: "irrelevant-for-this-test",
      },
    ];
    const verdict = evaluateProposal(makeProposal(), mandate, makeSimulation({ notionalUsd: 15 }), todaysFills, flatNav);
    expect(verdict.decision).toBe("VETO");
    expect(verdict.reasons.some((r) => r.rule === "dailySpendCapUsd" && r.outcome === "violated")).toBe(true);
  });

  it("halts all trading when the drawdown threshold is breached, regardless of order size", () => {
    const mandate = makeMandate({ dailyDrawdownHaltPct: 5 });
    const navContext = { currentNavUsd: 9400, startOfDayNavUsd: 10000 }; // down 6%
    const verdict = evaluateProposal(makeProposal({ quoteOrderQty: 1 }), mandate, makeSimulation({ notionalUsd: 1 }), noFills, navContext);
    expect(verdict.decision).toBe("VETO");
    expect(verdict.reasons.some((r) => r.rule === "dailyDrawdownHaltPct" && r.outcome === "violated")).toBe(true);
  });

  it("vetoes slippage beyond the mandate's limit", () => {
    const mandate = makeMandate({ maxSlippageBps: 10 });
    const simulation = makeSimulation({ projectedSlippageBps: 25 });
    const verdict = evaluateProposal(makeProposal(), mandate, simulation, noFills, flatNav);
    expect(verdict.decision).toBe("VETO");
    expect(verdict.reasons.some((r) => r.rule === "maxSlippageBps" && r.outcome === "violated")).toBe(true);
  });
});

describe("kill switch", () => {
  it("vetoes an otherwise compliant proposal while engaged", () => {
    const verdict = evaluateProposal(makeProposal(), makeMandate(), makeSimulation(), noFills, flatNav, {
      engaged: true,
      since: "2026-09-21T00:00:00.000Z",
      by: "alice",
      reason: "odd fills",
    });
    expect(verdict.decision).toBe("VETO");
    const rule = verdict.reasons.find((r) => r.rule === "killSwitch")!;
    expect(rule.outcome).toBe("violated");
    expect(rule.detail).toContain("alice");
    expect(rule.detail).toContain("odd fills");
  });

  it("vetoes a proposal that would otherwise escalate", () => {
    const mandate = makeMandate({ perTradeMaxUsd: 300, dailySpendCapUsd: 1000 });
    const verdict = evaluateProposal(makeProposal({ quoteOrderQty: 250 }), mandate, makeSimulation({ notionalUsd: 250 }), noFills, flatNav, {
      engaged: true,
    });
    expect(verdict.decision).toBe("VETO");
  });

  it("has no effect when released or never engaged", () => {
    const released = evaluateProposal(makeProposal(), makeMandate(), makeSimulation(), noFills, flatNav, { engaged: false });
    const absent = evaluateProposal(makeProposal(), makeMandate(), makeSimulation(), noFills, flatNav);
    expect(released.decision).toBe("PASS");
    expect(absent.decision).toBe("PASS");
  });
});

describe("evaluateProposal with the new rules", () => {
  const NOW = new Date("2026-09-21T12:00:00.000Z");
  const filled = (agentId: string, symbol: string, notionalUsd: number, minutesAgo: number): AuditEntry => ({
    seq: 0,
    timestamp: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    type: "EXECUTION_FILLED",
    venue: "testnet",
    payload: { agentId, symbol, notionalUsd },
    prevHash: "x",
    hash: "y",
  });

  it("a trade-rate limit vetoes an otherwise clean proposal, naming the rule", () => {
    const mandate = makeMandate({ maxTradesPerHour: 1 });
    const verdict = evaluateProposal(makeProposal({ agentId: "alpha" }), mandate, makeSimulation(), noFills, flatNav, undefined, {
      entries: [filled("alpha", "BTCUSDT", 15, 5)],
      now: NOW,
    });
    expect(verdict.decision).toBe("VETO");
    expect(verdict.reasons.find((r) => r.rule === "maxTradesPerHour")?.outcome).toBe("violated");
  });

  it("a cooldown and a per-symbol cap can each veto on their own", () => {
    const entries = [filled("alpha", "BTCUSDT", 100, 1)];
    const cool = evaluateProposal(makeProposal({ agentId: "alpha" }), makeMandate({ cooldownSeconds: 600 }), makeSimulation(), noFills, flatNav, undefined, { entries, now: NOW });
    const cap = evaluateProposal(makeProposal({ agentId: "alpha" }), makeMandate({ perSymbolDailyCapUsd: 110 }), makeSimulation(), noFills, flatNav, undefined, { entries, now: NOW });
    expect(cool.reasons.find((r) => r.rule === "cooldownSeconds")?.outcome).toBe("violated");
    expect(cap.reasons.find((r) => r.rule === "perSymbolDailyCapUsd")?.outcome).toBe("violated");
  });

  it("a SELL with no holdings supplied is vetoed rather than assumed covered", () => {
    const mandate = makeMandate({ allowedSides: ["BUY", "SELL"] });
    const verdict = evaluateProposal(makeProposal({ side: "SELL" }), mandate, makeSimulation(), noFills, flatNav);
    expect(verdict.decision).toBe("VETO");
    expect(verdict.reasons.find((r) => r.rule === "sellWithinHoldings")?.outcome).toBe("violated");
  });

  it("a SELL covered by holdings passes", () => {
    const mandate = makeMandate({ allowedSides: ["BUY", "SELL"] });
    const verdict = evaluateProposal(makeProposal({ side: "SELL" }), mandate, makeSimulation({ notionalUsd: 15, referencePrice: 60000 }), noFills, flatNav, undefined, {
      holdings: { BTC: 1 },
    });
    expect(verdict.decision).toBe("PASS");
  });

  it("a fat-fingered limit price is vetoed", () => {
    const verdict = evaluateProposal(
      makeProposal({ type: "LIMIT", limitPrice: 30000, quantity: 0.0005, quoteOrderQty: undefined }),
      makeMandate(),
      makeSimulation({ referencePrice: 60000, notionalUsd: 15 }),
      noFills,
      flatNav
    );
    expect(verdict.decision).toBe("VETO");
    expect(verdict.reasons.find((r) => r.rule === "maxLimitDeviationPct")?.outcome).toBe("violated");
  });

  it("a limit order is refused when the open-order limit could not be verified", () => {
    const verdict = evaluateProposal(
      makeProposal({ type: "LIMIT", limitPrice: 60000, quantity: 0.00025, quoteOrderQty: undefined }),
      makeMandate({ maxOpenOrders: 2 }),
      makeSimulation({ referencePrice: 60000, notionalUsd: 15 }),
      noFills,
      flatNav
    );
    expect(verdict.decision).toBe("VETO");
    expect(verdict.reasons.find((r) => r.rule === "maxOpenOrders")?.outcome).toBe("violated");
  });

  it("with none of the new limits set, a clean proposal still passes", () => {
    const verdict = evaluateProposal(makeProposal(), makeMandate(), makeSimulation(), noFills, flatNav);
    expect(verdict.decision).toBe("PASS");
  });
});
