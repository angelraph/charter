import { randomUUID } from "node:crypto";
import { activeVenue } from "../venues/index.js";
import { loadMandate } from "../mandate/store.js";
import { ProposalSchema, type Proposal, type Verdict } from "./types.js";
import { assessProposal } from "./assess.js";
import { executeProposal } from "../execution/adapter.js";
import { requestApproval } from "../approval/service.js";
import { auditLog } from "../audit/log.js";
import type { OrderResult } from "../venues/types.js";

export interface RunProposalInput {
  agentId: string;
  mandateId: string;
  symbol: string;
  side: "BUY" | "SELL";
  usd: number;
  reason?: string;
  /** Place the real order if the verdict is PASS. Has no effect on an ESCALATE, which always waits for a separate human approval. */
  execute: boolean;
}

export interface RunProposalResult {
  proposal: Proposal;
  verdict: Verdict;
  execution?: OrderResult;
  /** Present when the verdict is ESCALATE: the pending approval a human must act on. */
  approval?: { approvalId: string; expiresAt: string };
}

/**
 * The single real pipeline every entry point (CLI `propose`, the HTTP API,
 * the rogue-agent demo client) runs through: real simulation, real policy
 * evaluation, and real execution only on a PASS. An ESCALATE opens a pending
 * approval that a different person must grant; it can never execute here.
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

  const verdict = await assessProposal(proposal, mandate);

  if (verdict.decision === "VETO") {
    return { proposal, verdict };
  }

  if (verdict.decision === "ESCALATE") {
    const approval = await requestApproval(proposal, verdict);
    return { proposal, verdict, approval };
  }

  if (!input.execute) {
    return { proposal, verdict };
  }

  const execution = await executeProposal(activeVenue, proposal, verdict);
  return { proposal, verdict, execution };
}
