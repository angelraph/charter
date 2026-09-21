import { runProposal } from "../../policy/runProposal.js";

export interface ProposeOptions {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  usd?: number;
  quantity?: number;
  limitPrice?: number;
  mandateId: string;
  agentId: string;
  execute: boolean;
}

export async function proposeCommand(opts: ProposeOptions): Promise<void> {
  if (opts.type === "LIMIT") {
    console.log(`\n${opts.agentId} wants a limit ${opts.side} of ${opts.quantity} ${opts.symbol} at ${opts.limitPrice}`);
  } else {
    console.log(`\n${opts.agentId} wants to ${opts.side} $${opts.usd} of ${opts.symbol}`);
  }
  console.log("Simulating against live order book...");

  const { verdict, execution, approval } = await runProposal({
    agentId: opts.agentId,
    mandateId: opts.mandateId,
    symbol: opts.symbol,
    side: opts.side,
    type: opts.type,
    usd: opts.usd,
    quantity: opts.quantity,
    limitPrice: opts.limitPrice,
    reason: "CLI propose command",
    execute: opts.execute,
  });

  const s = verdict.simulation;
  console.log(
    `  reference price: ${s.referencePrice}  projected fill: ${s.projectedFillPrice.toFixed(2)}  ` +
      `slippage: ${s.projectedSlippageBps.toFixed(1)}bps  NAV impact: ${s.projectedNavImpactPct.toFixed(3)}%`
  );
  if (s.restingUsd > 0) {
    console.log(`  $${s.restingUsd.toFixed(2)} would not fill at once and would rest on the book at the limit price.`);
  }
  if (s.liquidityInsufficient) {
    console.log(
      `  WARNING: sampled order-book depth could not fully cover this notional (unfilled: $${s.unfilledUsd.toFixed(2)}). ` +
        `Projected slippage/fill price above reflect only the fillable portion and understate real impact.`
    );
  }

  console.log(`\nVerdict: ${verdict.decision}`);
  for (const r of verdict.reasons) {
    const marker = r.outcome === "violated" ? "✗" : r.outcome === "warning" ? "!" : "✓";
    console.log(`  [${marker}] ${r.rule}: ${r.detail}`);
  }

  if (verdict.decision === "VETO") {
    console.log("\nVETOed. No order was placed, and no EXECUTION_ATTEMPTED entry will appear in the audit log for this proposal.");
    return;
  }

  if (execution && (execution.status === "NEW" || execution.status === "PARTIALLY_FILLED")) {
    console.log(
      `\nPlaced and resting: orderId=${execution.orderId} status=${execution.status} executedQty=${execution.executedQty}. ` +
        `It can still fill later. Cancel it with: charter cancel ${execution.symbol} ${execution.orderId}`
    );
    return;
  }

  if (execution) {
    console.log(`\nFilled: orderId=${execution.orderId} status=${execution.status} executedQty=${execution.executedQty} quoteQty=${execution.cummulativeQuoteQty}`);
    return;
  }

  if (verdict.decision === "ESCALATE" && approval) {
    console.log(
      `\nESCALATE. This proposal crosses the confirm-above threshold, so it is waiting on a human approval. ` +
        `Nothing was placed, and --execute does not bypass this.\n` +
        `  approval id: ${approval.approvalId}\n` +
        `  expires:     ${approval.expiresAt}\n` +
        `A different person approves it with:\n` +
        `  charter approve ${approval.approvalId} --approver <name>`
    );
  } else {
    console.log("\nPASS. Re-run with --execute to actually place the real order.");
  }
}
