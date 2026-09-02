import { randomUUID } from "node:crypto";
import { activeVenue, marketDataBaseUrl } from "../../venues/index.js";
import { loadMandate } from "../../mandate/store.js";
import { ProposalSchema, type Proposal } from "../../policy/types.js";
import { simulateProposal } from "../../market/simulator.js";
import { computeApproxNavUsd } from "../../market/nav.js";
import { evaluateProposal } from "../../policy/engine.js";
import { executeProposal } from "../../execution/adapter.js";
import { auditLog } from "../../audit/log.js";

export interface ProposeOptions {
  symbol: string;
  side: "BUY" | "SELL";
  usd: number;
  mandateId: string;
  agentId: string;
  execute: boolean;
}

function todayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function proposeCommand(opts: ProposeOptions): Promise<void> {
  const mandate = await loadMandate(opts.mandateId);

  const proposal: Proposal = ProposalSchema.parse({
    id: randomUUID(),
    agentId: opts.agentId,
    mandateId: mandate.id,
    symbol: opts.symbol,
    side: opts.side,
    type: "MARKET",
    quoteOrderQty: opts.usd,
    reason: "CLI propose command",
    submittedAt: new Date().toISOString(),
  });

  await auditLog.append("PROPOSAL_RECEIVED", activeVenue.name, { proposal });
  console.log(`\nProposal ${proposal.id}: ${proposal.agentId} wants to ${proposal.side} $${opts.usd} of ${proposal.symbol}`);

  console.log("Simulating against live order book...");
  const navUsd = await computeApproxNavUsd(activeVenue, marketDataBaseUrl());
  const simulation = await simulateProposal(activeVenue, proposal, navUsd);
  console.log(
    `  reference price: ${simulation.referencePrice}  projected fill: ${simulation.projectedFillPrice.toFixed(2)}  ` +
      `slippage: ${simulation.projectedSlippageBps.toFixed(1)}bps  NAV impact: ${simulation.projectedNavImpactPct.toFixed(3)}%`
  );

  const todaysEntries = (await auditLog.all()).filter(
    (e) => e.type === "EXECUTION_FILLED" && e.timestamp >= todayStartIso()
  );
  const verdict = evaluateProposal(proposal, mandate, simulation, todaysEntries);
  await auditLog.append("VERDICT_ISSUED", activeVenue.name, { verdict });

  console.log(`\nVerdict: ${verdict.decision}`);
  for (const r of verdict.reasons) {
    const marker = r.outcome === "violated" ? "✗" : r.outcome === "warning" ? "!" : "✓";
    console.log(`  [${marker}] ${r.rule}: ${r.detail}`);
  }

  if (verdict.decision === "VETO") {
    console.log("\nVETOed — no order was placed. No EXECUTION_ATTEMPTED entry will appear in the audit log for this proposal.");
    return;
  }

  if (verdict.decision === "ESCALATE") {
    console.log("\nESCALATE — this proposal crosses the confirm-above threshold and needs explicit human sign-off.");
    if (!opts.execute) {
      console.log("Re-run with --execute to confirm and place the real order.");
      return;
    }
    console.log("--execute supplied: treating as human confirmation, proceeding.");
  }

  if (!opts.execute) {
    console.log("\nPASS — re-run with --execute to actually place the real order.");
    return;
  }

  console.log(`\nPlacing real order on venue "${activeVenue.name}"...`);
  const result = await executeProposal(activeVenue, proposal, verdict);
  console.log(`Filled: orderId=${result.orderId} status=${result.status} executedQty=${result.executedQty} quoteQty=${result.cummulativeQuoteQty}`);
}
