import type { Mandate } from "../../mandate/schema.js";
import type { RuleResult } from "../types.js";

/**
 * Compares current NAV against the day's opening NAV snapshot (see
 * mandate/navSnapshot.ts). If the account has dropped by more than
 * dailyDrawdownHaltPct since the start of the day, every proposal is
 * vetoed regardless of its own size, a portfolio-level circuit breaker,
 * not a per-trade one.
 */
export function checkDrawdownHalt(currentNavUsd: number, startOfDayNavUsd: number, mandate: Mandate): RuleResult {
  if (startOfDayNavUsd <= 0) {
    return { rule: "dailyDrawdownHaltPct", outcome: "ok", detail: "No start-of-day NAV baseline yet, skipping drawdown check" };
  }
  const drawdownPct = ((startOfDayNavUsd - currentNavUsd) / startOfDayNavUsd) * 100;
  if (drawdownPct >= mandate.limits.dailyDrawdownHaltPct) {
    return {
      rule: "dailyDrawdownHaltPct",
      outcome: "violated",
      detail: `Account is down ${drawdownPct.toFixed(2)}% today (NAV $${startOfDayNavUsd.toFixed(2)} -> $${currentNavUsd.toFixed(2)}), at or beyond the ${mandate.limits.dailyDrawdownHaltPct}% halt threshold. All trading is halted for the rest of the day.`,
    };
  }
  return {
    rule: "dailyDrawdownHaltPct",
    outcome: "ok",
    detail: `Account is ${drawdownPct >= 0 ? "down" : "up"} ${Math.abs(drawdownPct).toFixed(2)}% today, within the ${mandate.limits.dailyDrawdownHaltPct}% halt threshold`,
  };
}
