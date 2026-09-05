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
