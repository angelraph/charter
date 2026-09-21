import type { Mandate } from "../../mandate/schema.js";
import type { Proposal, RuleResult, SimulationResult } from "../types.js";
import { baseAssetOf } from "../../market/symbols.js";

const DEFAULT_MAX_LIMIT_DEVIATION_PCT = 5;

/**
 * A limit price far from the market is far more often a typo than a
 * strategy. Refused in either direction, since a BUY priced far above the
 * market pays up to that price and one far below rests untouched.
 */
export function checkLimitPrice(proposal: Proposal, mandate: Mandate, simulation: SimulationResult): RuleResult {
  if (proposal.type !== "LIMIT" || proposal.limitPrice === undefined) {
    return { rule: "maxLimitDeviationPct", outcome: "ok", detail: "Not a limit order" };
  }
  const max = mandate.limits.maxLimitDeviationPct ?? DEFAULT_MAX_LIMIT_DEVIATION_PCT;
  const deviation = (Math.abs(proposal.limitPrice - simulation.referencePrice) / simulation.referencePrice) * 100;

  if (deviation > max) {
    return {
      rule: "maxLimitDeviationPct",
      outcome: "violated",
      detail: `Limit price ${proposal.limitPrice} is ${deviation.toFixed(2)}% from the market price ${simulation.referencePrice}, beyond the ${max}% allowed`,
    };
  }
  return { rule: "maxLimitDeviationPct", outcome: "ok", detail: `Limit price is ${deviation.toFixed(2)}% from the market, within ${max}%` };
}

/** Resting limit orders can fill later, so the number allowed to sit on the book at once is capped. */
export function checkOpenOrders(proposal: Proposal, mandate: Mandate, openOrderCount: number | undefined): RuleResult {
  const max = mandate.limits.maxOpenOrders;
  if (max === undefined || proposal.type !== "LIMIT") {
    return { rule: "maxOpenOrders", outcome: "ok", detail: "No open-order limit applies" };
  }
  if (openOrderCount === undefined) {
    return { rule: "maxOpenOrders", outcome: "violated", detail: "Could not read the open orders, so the open-order limit cannot be verified" };
  }
  if (openOrderCount >= max) {
    return { rule: "maxOpenOrders", outcome: "violated", detail: `${openOrderCount} CHARTER orders are already resting, at the limit of ${max}` };
  }
  return { rule: "maxOpenOrders", outcome: "ok", detail: `${openOrderCount} of ${max} allowed open orders in use` };
}

/**
 * A SELL has to be covered by what is actually held. If holdings could not
 * be read, the SELL is refused rather than assumed to be covered.
 */
export function checkSellWithinHoldings(proposal: Proposal, simulation: SimulationResult, holdings: Record<string, number> | undefined): RuleResult {
  if (proposal.side !== "SELL") return { rule: "sellWithinHoldings", outcome: "ok", detail: "Not a sell" };

  const base = baseAssetOf(proposal.symbol);
  if (!base) return { rule: "sellWithinHoldings", outcome: "violated", detail: `Cannot tell which asset ${proposal.symbol} sells, so holdings cannot be checked` };
  if (!holdings) return { rule: "sellWithinHoldings", outcome: "violated", detail: "Could not read holdings, so the sell cannot be checked against them" };

  const needed = proposal.quantity ?? simulation.notionalUsd / simulation.referencePrice;
  const held = holdings[base] ?? 0;
  if (needed > held) {
    return { rule: "sellWithinHoldings", outcome: "violated", detail: `Selling about ${needed.toFixed(8)} ${base} but only ${held} is free to sell` };
  }
  return { rule: "sellWithinHoldings", outcome: "ok", detail: `Selling about ${needed.toFixed(8)} ${base} of ${held} held` };
}
