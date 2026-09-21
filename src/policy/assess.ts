import { activeVenue, marketDataBaseUrl } from "../venues/index.js";
import type { Mandate } from "../mandate/schema.js";
import type { Proposal, Verdict } from "./types.js";
import { simulateProposal } from "../market/simulator.js";
import { valueHoldings } from "../market/nav.js";
import { getAllTickerPrices } from "../market/binanceRest.js";
import { getOrCreateStartOfDayNav } from "../mandate/navSnapshot.js";
import { evaluateProposal } from "./engine.js";
import { deriveKillSwitch } from "../approval/state.js";
import { listOpenCharterOrders } from "../execution/orders.js";
import { auditLog } from "../audit/log.js";

function todayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Simulates a proposal against the live order book and evaluates it against
 * the mandate, the day's spend, the drawdown baseline, the kill switch, and
 * recent activity, then records the verdict. Used for a proposal's first
 * evaluation and again, with fresh market data, when a human approval is
 * about to be acted on.
 */
export async function assessProposal(proposal: Proposal, mandate: Mandate, extra: Record<string, unknown> = {}): Promise<Verdict> {
  // One balances call and one prices call serve both the NAV figure and the
  // holdings a SELL is checked against.
  const [balances, prices] = await Promise.all([activeVenue.getSubAccountBalances(), getAllTickerPrices(marketDataBaseUrl())]);
  const navUsd = valueHoldings(balances, prices).navUsd;
  const holdings = Object.fromEntries(balances.map((b) => [b.asset, b.free]));

  const simulation = await simulateProposal(activeVenue, proposal, navUsd);

  const entries = await auditLog.all();
  // A resting order can still fill, so placed orders count toward the daily spend alongside filled ones.
  const todaysCommitted = entries.filter((e) => (e.type === "EXECUTION_FILLED" || e.type === "EXECUTION_PLACED") && e.timestamp >= todayStartIso());
  const startOfDayNavUsd = await getOrCreateStartOfDayNav(activeVenue, marketDataBaseUrl());
  const killSwitch = deriveKillSwitch(entries);

  // Only ask the exchange about open orders when the mandate has a limit that needs the answer.
  const needsOpenOrders = mandate.limits.maxOpenOrders !== undefined && proposal.type === "LIMIT";
  const openOrderCount = needsOpenOrders ? (await listOpenCharterOrders(activeVenue)).length : undefined;

  const verdict = evaluateProposal(proposal, mandate, simulation, todaysCommitted, { currentNavUsd: navUsd, startOfDayNavUsd }, killSwitch, {
    entries,
    holdings,
    openOrderCount,
  });
  await auditLog.append("VERDICT_ISSUED", activeVenue.name, { verdict, ...extra });
  return verdict;
}
