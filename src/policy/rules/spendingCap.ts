import type { Mandate } from "../../mandate/schema.js";
import type { Proposal, RuleResult, SimulationResult } from "../types.js";
import type { AuditEntry } from "../../audit/log.js";

/** Rolling daily spend, computed from today's EXECUTION_FILLED audit entries — not a separate counter that can drift. */
export function checkSpendingCap(
  proposal: Proposal,
  mandate: Mandate,
  simulation: SimulationResult,
  todaysFilledEntries: AuditEntry[]
): RuleResult {
  const spentToday = todaysFilledEntries.reduce((sum, e) => {
    const payload = e.payload as { notionalUsd?: number };
    return sum + (payload.notionalUsd ?? 0);
  }, 0);

  if (simulation.notionalUsd > mandate.limits.perTradeMaxUsd) {
    return {
      rule: "perTradeMaxUsd",
      outcome: "violated",
      detail: `Proposal notional $${simulation.notionalUsd.toFixed(2)} exceeds perTradeMaxUsd $${mandate.limits.perTradeMaxUsd}`,
    };
  }

  const projectedTotal = spentToday + simulation.notionalUsd;
  if (projectedTotal > mandate.limits.dailySpendCapUsd) {
    return {
      rule: "dailySpendCapUsd",
      outcome: "violated",
      detail: `Today's spend $${spentToday.toFixed(2)} + this proposal $${simulation.notionalUsd.toFixed(2)} = $${projectedTotal.toFixed(2)} exceeds dailySpendCapUsd $${mandate.limits.dailySpendCapUsd}`,
    };
  }

  return {
    rule: "spendingCap",
    outcome: "ok",
    detail: `Notional $${simulation.notionalUsd.toFixed(2)}, today's total after this trade would be $${projectedTotal.toFixed(2)} of $${mandate.limits.dailySpendCapUsd} cap`,
  };
}
