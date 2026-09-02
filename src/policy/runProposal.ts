import { randomUUID } from "node:crypto";
import { activeVenue, marketDataBaseUrl } from "../venues/index.js";
import { loadMandate } from "../mandate/store.js";
import { ProposalSchema, type Proposal, type Verdict } from "./types.js";
import { simulateProposal } from "../market/simulator.js";
import { computeApproxNavUsd } from "../market/nav.js";
import { getOrCreateStartOfDayNav } from "../mandate/navSnapshot.js";
import { evaluateProposal } from "./engine.js";
import { executeProposal } from "../execution/adapter.js";
import { auditLog } from "../audit/log.js";
import type { OrderResult } from "../venues/types.js";

export interface RunProposalInput {
  agentId: string;
  mandateId: string;
  symbol: string;
  side: "BUY" | "SELL";
  usd: number;
  reason?: string;
  /** Execute a real order on PASS, or on ESCALATE when the caller is standing in as the human confirmation. */
  execute: boolean;
}

export interface RunProposalResult {
  proposal: Proposal;
  verdict: Verdict;
  execution?: OrderResult;
}

function todayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * The single real pipeline every entry point (CLI `propose`, the local
 * HTTP API, the rogue-agent demo client) runs through: real simulation,
 * real policy evaluation, real execution on PASS. No caller bypasses this.
 */
export async function runProposal(input: RunProposalInput): Promise<RunProposalResult> {
  const mandate = await loadMandate(input.mandateId);

  const proposal: Proposal = ProposalSchema.parse({
    id: randomUUID(),
    agentId: input.agentId,
    mandateId: mandate.id,
    symbol: input.symbol,
    side: input.side,
    type: "MARKET",
    quoteOrderQty: input.usd,
    reason: input.reason,
    submittedAt: new Date().toISOString(),
  });

  await auditLog.append("PROPOSAL_RECEIVED", activeVenue.name, { proposal });

  const navUsd = await computeApproxNavUsd(activeVenue, marketDataBaseUrl());
  const simulation = await simulateProposal(activeVenue, proposal, navUsd);

  const todaysEntries = (await auditLog.all()).filter((e) => e.type === "EXECUTION_FILLED" && e.timestamp >= todayStartIso());
  const startOfDayNavUsd = await getOrCreateStartOfDayNav(activeVenue, marketDataBaseUrl());
  const verdict = evaluateProposal(proposal, mandate, simulation, todaysEntries, { currentNavUsd: navUsd, startOfDayNavUsd });
  await auditLog.append("VERDICT_ISSUED", activeVenue.name, { verdict });

  if (verdict.decision === "VETO") {
    return { proposal, verdict };
  }
  if (verdict.decision === "ESCALATE" && !input.execute) {
    return { proposal, verdict };
  }
  if (verdict.decision === "PASS" && !input.execute) {
    return { proposal, verdict };
  }

  if (verdict.decision === "ESCALATE") {
    // input.execute === true here means a human explicitly confirmed this above-threshold trade.
    await auditLog.append("EXECUTION_CONFIRMED", activeVenue.name, {
      proposalId: proposal.id,
      verdictId: verdict.id,
      note: "ESCALATE threshold crossed; human confirmation supplied via --execute",
    });
  }

  const execution = await executeProposal(activeVenue, proposal, { ...verdict, decision: "PASS" });
  return { proposal, verdict, execution };
}
