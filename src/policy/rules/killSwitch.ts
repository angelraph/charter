import type { RuleResult } from "../types.js";
import type { KillSwitchState } from "../../approval/state.js";

/**
 * Operator-level circuit breaker. While engaged, every proposal is vetoed
 * regardless of size or mandate, including one that a human already
 * approved but that hasn't executed yet.
 */
export function checkKillSwitch(state: KillSwitchState | undefined): RuleResult {
  if (state?.engaged) {
    const who = state.by ? ` by ${state.by}` : "";
    const why = state.reason ? `: ${state.reason}` : "";
    return {
      rule: "killSwitch",
      outcome: "violated",
      detail: `Trading is halted${who} since ${state.since}${why}. Nothing executes until it is released.`,
    };
  }
  return { rule: "killSwitch", outcome: "ok", detail: "Kill switch is not engaged" };
}
