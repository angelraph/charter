import type { ExecutionVenue, OrderBook } from "../venues/types.js";
import type { Proposal, SimulationResult } from "../policy/types.js";

/**
 * Walks the REAL order book of whichever venue will execute the trade
 * (never a different venue's book, that would make projected vs. actual
 * numbers dishonest) to estimate fill price and slippage for a proposal's
 * notional size.
 */
export async function simulateProposal(venue: ExecutionVenue, proposal: Proposal, navUsd: number): Promise<SimulationResult> {
  const depth: OrderBook = await venue.getDepth(proposal.symbol, 50);
  const levels = proposal.side === "BUY" ? depth.asks : depth.bids;
  if (levels.length === 0) {
    throw new Error(`No ${proposal.side === "BUY" ? "ask" : "bid"} liquidity available for ${proposal.symbol}`);
  }

  const referencePrice = levels[0]!.price;
  const notionalUsd = proposal.quoteOrderQty ?? (proposal.quantity ?? 0) * referencePrice;

  // Walk the book to find the volume-weighted average fill price for this notional.
  let remainingUsd = notionalUsd;
  let filledUsd = 0;
  let filledBaseQty = 0;
  for (const level of levels) {
    const levelNotional = level.price * level.quantity;
    const take = Math.min(remainingUsd, levelNotional);
    if (take <= 0) break;
    filledUsd += take;
    filledBaseQty += take / level.price;
    remainingUsd -= take;
    if (remainingUsd <= 0) break;
  }

  const projectedFillPrice = filledBaseQty > 0 ? filledUsd / filledBaseQty : referencePrice;
  const projectedSlippageBps = referencePrice > 0 ? ((projectedFillPrice - referencePrice) / referencePrice) * 10_000 * (proposal.side === "BUY" ? 1 : -1) : 0;
  const projectedNavImpactPct = navUsd > 0 ? (notionalUsd / navUsd) * 100 : 0;

  // If the sampled depth ran out before covering the full notional, the numbers
  // above only describe the fillable portion and understate the real impact.
  // liquidityInsufficient/unfilledUsd are the authoritative signal of that, not
  // projectedFillPrice/projectedSlippageBps.
  const liquidityInsufficient = remainingUsd > 0;
  const unfilledUsd = liquidityInsufficient ? remainingUsd : 0;

  return {
    venue: venue.name,
    referencePrice,
    projectedFillPrice,
    projectedSlippageBps: Math.max(0, projectedSlippageBps),
    notionalUsd,
    projectedNavImpactPct,
    orderBookDepthSampledAt: depth.sampledAt,
    liquidityInsufficient,
    unfilledUsd,
  };
}
