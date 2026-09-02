import type { Mandate } from "../../mandate/schema.js";
import type { RuleResult, SimulationResult } from "../types.js";

/** Not a VETO by itself — crossing this threshold escalates to a human, it doesn't block. */
export function checkConfirmAbove(simulation: SimulationResult, mandate: Mandate): RuleResult {
  if (simulation.notionalUsd > mandate.limits.confirmAboveUsd) {
    return {
      rule: "confirmAboveUsd",
      outcome: "warning",
      detail: `Notional $${simulation.notionalUsd.toFixed(2)} exceeds confirmAboveUsd $${mandate.limits.confirmAboveUsd} — requires explicit human confirmation`,
    };
  }
  return {
    rule: "confirmAboveUsd",
    outcome: "ok",
    detail: `Notional $${simulation.notionalUsd.toFixed(2)} is within the auto-confirm threshold of $${mandate.limits.confirmAboveUsd}`,
  };
}
