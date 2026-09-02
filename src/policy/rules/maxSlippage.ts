import type { Mandate } from "../../mandate/schema.js";
import type { RuleResult, SimulationResult } from "../types.js";

export function checkMaxSlippage(simulation: SimulationResult, mandate: Mandate): RuleResult {
  const limit = mandate.limits.maxSlippageBps;
  if (limit === undefined) {
    return { rule: "maxSlippageBps", outcome: "ok", detail: "No slippage limit configured on this mandate" };
  }
  if (simulation.projectedSlippageBps > limit) {
    return {
      rule: "maxSlippageBps",
      outcome: "violated",
      detail: `Projected slippage ${simulation.projectedSlippageBps.toFixed(1)}bps exceeds maxSlippageBps ${limit}`,
    };
  }
  return {
    rule: "maxSlippageBps",
    outcome: "ok",
    detail: `Projected slippage ${simulation.projectedSlippageBps.toFixed(1)}bps is within ${limit}bps limit`,
  };
}
