import type { Mandate } from "../mandate/schema.js";
import type { Proposal, RuleResult, SimulationResult, Verdict, VerdictDecision } from "./types.js";
import type { AuditEntry } from "../audit/log.js";
import { checkSpendingCap } from "./rules/spendingCap.js";
import { checkConfirmAbove } from "./rules/confirmAboveX.js";
import { checkSymbolAllowlist } from "./rules/symbolAllowlist.js";
import { checkMaxSlippage } from "./rules/maxSlippage.js";
import { checkLeverageLimit } from "./rules/leverageLimit.js";
import { checkDrawdownHalt } from "./rules/drawdownHalt.js";
import { checkKillSwitch } from "./rules/killSwitch.js";
import { checkCooldown, checkPerSymbolDailyCap, checkTradeRate } from "./rules/activity.js";
import { checkLimitPrice, checkOpenOrders, checkSellWithinHoldings } from "./rules/orders.js";
import type { KillSwitchState } from "../approval/state.js";
import { randomUUID } from "node:crypto";

/** Extra facts some rules need. Every field is optional; a rule that needs one it was not given fails closed. */
export interface EvaluationContext {
  /** The whole audit log, for the rules that depend on what has already been executed. */
  entries?: AuditEntry[];
  /** Free balance per asset, for checking a SELL is covered. */
  holdings?: Record<string, number>;
  /** How many CHARTER limit orders are resting on the book right now. */
  openOrderCount?: number;
  now?: Date;
}

/**
 * Evaluates a proposal against a mandate using a real simulation. Any
 * `violated` rule -> VETO (execution never attempted). Otherwise, any
 * `warning` (confirm-above-threshold) -> ESCALATE. Otherwise PASS.
 */
export function evaluateProposal(
  proposal: Proposal,
  mandate: Mandate,
  simulation: SimulationResult,
  todaysFilledEntries: AuditEntry[],
  navContext: { currentNavUsd: number; startOfDayNavUsd: number },
  killSwitch?: KillSwitchState,
  context: EvaluationContext = {}
): Verdict {
  const entries = context.entries ?? [];
  const now = context.now ?? new Date();

  const reasons: RuleResult[] = [
    checkKillSwitch(killSwitch),
    checkSymbolAllowlist(proposal, mandate),
    checkSpendingCap(proposal, mandate, simulation, todaysFilledEntries),
    checkPerSymbolDailyCap(proposal, mandate, simulation, entries, now),
    checkTradeRate(proposal, mandate, entries, now),
    checkCooldown(proposal, mandate, entries, now),
    checkLimitPrice(proposal, mandate, simulation),
    checkOpenOrders(proposal, mandate, context.openOrderCount),
    checkSellWithinHoldings(proposal, simulation, context.holdings),
    checkMaxSlippage(simulation, mandate),
    checkLeverageLimit(mandate),
    checkDrawdownHalt(navContext.currentNavUsd, navContext.startOfDayNavUsd, mandate),
    checkConfirmAbove(simulation, mandate),
  ];

  let decision: VerdictDecision = "PASS";
  if (reasons.some((r) => r.outcome === "violated")) {
    decision = "VETO";
  } else if (reasons.some((r) => r.outcome === "warning")) {
    decision = "ESCALATE";
  }

  return {
    id: randomUUID(),
    proposalId: proposal.id,
    decision,
    reasons,
    simulation,
    decidedAt: new Date().toISOString(),
    policyVersion: mandate.version,
  };
}
