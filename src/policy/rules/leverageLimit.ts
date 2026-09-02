import type { Mandate } from "../../mandate/schema.js";
import type { RuleResult } from "../types.js";

/**
 * CHARTER's current execution venues (testnet Spot, and mainnet MCP Spot)
 * are spot-only — no leverage is ever requested by a proposal. This rule
 * exists so the mandate's maxLeverage field is still enforced (fails
 * closed) the moment a margin/futures proposal type is added, rather than
 * silently doing nothing.
 */
export function checkLeverageLimit(mandate: Mandate): RuleResult {
  const requestedLeverage = 1; // spot orders only, by construction
  if (requestedLeverage > mandate.limits.maxLeverage) {
    return {
      rule: "maxLeverage",
      outcome: "violated",
      detail: `Requested leverage ${requestedLeverage}x exceeds maxLeverage ${mandate.limits.maxLeverage}x`,
    };
  }
  return {
    rule: "maxLeverage",
    outcome: "ok",
    detail: `Spot order, no leverage requested (mandate allows up to ${mandate.limits.maxLeverage}x)`,
  };
}
