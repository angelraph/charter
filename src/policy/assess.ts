import { activeVenue, marketDataBaseUrl } from "../venues/index.js";
import type { Mandate } from "../mandate/schema.js";
import type { Proposal, Verdict } from "./types.js";
import { simulateProposal } from "../market/simulator.js";
import { computeApproxNavUsd } from "../market/nav.js";
import { getOrCreateStartOfDayNav } from "../mandate/navSnapshot.js";
import { evaluateProposal } from "./engine.js";
import { deriveKillSwitch } from "../approval/state.js";
import { auditLog } from "../audit/log.js";

function todayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Simulates a proposal against the live order book and evaluates it against
 * the mandate, the day's spend, the drawdown baseline, and the kill switch,
 * then records the verdict. Used for a proposal's first evaluation and again,
 * with fresh market data, when a human approval is about to be acted on.
 */
export async function assessProposal(proposal: Proposal, mandate: Mandate, extra: Record<string, unknown> = {}): Promise<Verdict> {
  const navUsd = await computeApproxNavUsd(activeVenue, marketDataBaseUrl());
  const simulation = await simulateProposal(activeVenue, proposal, navUsd);

  const entries = await auditLog.all();
  const todaysFilled = entries.filter((e) => e.type === "EXECUTION_FILLED" && e.timestamp >= todayStartIso());
  const startOfDayNavUsd = await getOrCreateStartOfDayNav(activeVenue, marketDataBaseUrl());
  const killSwitch = deriveKillSwitch(entries);

  const verdict = evaluateProposal(proposal, mandate, simulation, todaysFilled, { currentNavUsd: navUsd, startOfDayNavUsd }, killSwitch);
  await auditLog.append("VERDICT_ISSUED", activeVenue.name, { verdict, ...extra });
  return verdict;
}
