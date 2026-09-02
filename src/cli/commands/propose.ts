import { runProposal } from "../../policy/runProposal.js";

export interface ProposeOptions {
  symbol: string;
  side: "BUY" | "SELL";
  usd: number;
  mandateId: string;
  agentId: string;
  execute: boolean;
}

export async function proposeCommand(opts: ProposeOptions): Promise<void> {
  console.log(`\n${opts.agentId} wants to ${opts.side} $${opts.usd} of ${opts.symbol}`);
  console.log("Simulating against live order book...");

  const { verdict, execution } = await runProposal({
    agentId: opts.agentId,
    mandateId: opts.mandateId,
    symbol: opts.symbol,
    side: opts.side,
    usd: opts.usd,
    reason: "CLI propose command",
    execute: opts.execute,
  });

  const s = verdict.simulation;
  console.log(
    `  reference price: ${s.referencePrice}  projected fill: ${s.projectedFillPrice.toFixed(2)}  ` +
      `slippage: ${s.projectedSlippageBps.toFixed(1)}bps  NAV impact: ${s.projectedNavImpactPct.toFixed(3)}%`
  );

  console.log(`\nVerdict: ${verdict.decision}`);
  for (const r of verdict.reasons) {
    const marker = r.outcome === "violated" ? "✗" : r.outcome === "warning" ? "!" : "✓";
    console.log(`  [${marker}] ${r.rule}: ${r.detail}`);
  }

  if (verdict.decision === "VETO") {
    console.log("\nVETOed — no order was placed. No EXECUTION_ATTEMPTED entry will appear in the audit log for this proposal.");
    return;
  }

  if (execution) {
    console.log(`\nFilled: orderId=${execution.orderId} status=${execution.status} executedQty=${execution.executedQty} quoteQty=${execution.cummulativeQuoteQty}`);
    return;
  }

  if (verdict.decision === "ESCALATE") {
    console.log("\nESCALATE — this proposal crosses the confirm-above threshold and needs explicit human sign-off. Re-run with --execute to confirm and place the real order.");
  } else {
    console.log("\nPASS — re-run with --execute to actually place the real order.");
  }
}
