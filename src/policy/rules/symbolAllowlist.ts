import type { Mandate } from "../../mandate/schema.js";
import type { Proposal, RuleResult } from "../types.js";

export function checkSymbolAllowlist(proposal: Proposal, mandate: Mandate): RuleResult {
  const { allowedSymbols, blockedSymbols, allowedSides } = mandate.limits;

  if (blockedSymbols?.includes(proposal.symbol)) {
    return { rule: "symbolAllowlist", outcome: "violated", detail: `${proposal.symbol} is explicitly blocked by this mandate` };
  }
  if (allowedSymbols && !allowedSymbols.includes(proposal.symbol)) {
    return {
      rule: "symbolAllowlist",
      outcome: "violated",
      detail: `${proposal.symbol} is not in the allowed symbol list [${allowedSymbols.join(", ")}]`,
    };
  }
  if (allowedSides && !allowedSides.includes(proposal.side)) {
    return {
      rule: "symbolAllowlist",
      outcome: "violated",
      detail: `Side ${proposal.side} is not permitted; allowed sides are [${allowedSides.join(", ")}]`,
    };
  }
  return { rule: "symbolAllowlist", outcome: "ok", detail: `${proposal.symbol} ${proposal.side} is permitted` };
}
