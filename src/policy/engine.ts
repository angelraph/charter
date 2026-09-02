import type { Mandate } from "../mandate/schema.js";
import type { Proposal, RuleResult, SimulationResult, Verdict, VerdictDecision } from "./types.js";
import type { AuditEntry } from "../audit/log.js";
import { checkSpendingCap } from "./rules/spendingCap.js";
import { checkConfirmAbove } from "./rules/confirmAboveX.js";
import { checkSymbolAllowlist } from "./rules/symbolAllowlist.js";
import { checkMaxSlippage } from "./rules/maxSlippage.js";
import { randomUUID } from "node:crypto";

/**
 * Evaluates a proposal against a mandate using a real simulation. Any
 * `violated` rule -> VETO (execution never attempted). Otherwise, any
 * `warning` (confirm-above-threshold) -> ESCALATE. Otherwise PASS.
 */
export function evaluateProposal(
  proposal: Proposal,
  mandate: Mandate,
  simulation: SimulationResult,
  todaysFilledEntries: AuditEntry[]
): Verdict {
  const reasons: RuleResult[] = [
    checkSymbolAllowlist(proposal, mandate),
    checkSpendingCap(proposal, mandate, simulation, todaysFilledEntries),
    checkMaxSlippage(simulation, mandate),
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
