import type { ExecutionVenue, OrderRequest, OrderResult } from "../venues/types.js";
import type { Proposal, Verdict } from "../policy/types.js";
import { auditLog } from "../audit/log.js";

export interface ApprovalRef {
  approvalId: string;
  approver: string;
}

/**
 * The ONLY path by which a real order reaches the venue. Runs on a PASS,
 * or on an ESCALATE that carries a real approval. VETOs and un-approved
 * ESCALATEs never reach the venue, which is exactly what the audit log
 * proves: such a proposal has no EXECUTION_ATTEMPTED entry at all.
 */
export async function executeProposal(
  venue: ExecutionVenue,
  proposal: Proposal,
  verdict: Verdict,
  approval?: ApprovalRef
): Promise<OrderResult> {
  // PASS executes on its own. ESCALATE executes only with a real approval attached.
  const allowed = verdict.decision === "PASS" || (verdict.decision === "ESCALATE" && approval !== undefined);
  if (!allowed) {
    throw new Error(`Refusing to execute proposal ${proposal.id}: verdict was ${verdict.decision}, not PASS or an approved ESCALATE`);
  }

  const order: OrderRequest = {
    symbol: proposal.symbol,
    side: proposal.side,
    type: proposal.type,
    quantity: proposal.quantity,
    quoteOrderQty: proposal.quoteOrderQty,
    limitPrice: proposal.limitPrice,
    clientOrderId: `charter-${proposal.id.slice(0, 8)}`,
  };

  await auditLog.append("EXECUTION_ATTEMPTED", venue.name, {
    proposalId: proposal.id,
    verdictId: verdict.id,
    order,
    notionalUsd: verdict.simulation.notionalUsd,
    ...(approval ? { approvalId: approval.approvalId, approvedBy: approval.approver } : {}),
  });

  let result: OrderResult;
  try {
    result = await venue.placeOrder(order);
  } catch (err) {
    await auditLog.append("EXECUTION_REJECTED_BY_PLATFORM", venue.name, {
      proposalId: proposal.id,
      verdictId: verdict.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  await auditLog.append("EXECUTION_FILLED", venue.name, {
    proposalId: proposal.id,
    verdictId: verdict.id,
    orderId: result.orderId,
    symbol: result.symbol,
    side: result.side,
    status: result.status,
    executedQty: result.executedQty,
    cummulativeQuoteQty: result.cummulativeQuoteQty,
    fills: result.fills,
    notionalUsd: verdict.simulation.notionalUsd,
    ...(approval ? { approvalId: approval.approvalId, approvedBy: approval.approver } : {}),
  });

  return result;
}
