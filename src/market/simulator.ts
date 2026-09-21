import type { ExecutionVenue, OrderBook } from "../venues/types.js";
import type { Proposal, SimulationResult } from "../policy/types.js";

/**
 * Walks the REAL order book of whichever venue will execute the trade
 * (never a different venue's book, that would make projected vs. actual
 * numbers dishonest) to estimate fill price and slippage for a proposal's
 * notional size.
 *
 * MARKET: walks the book until the notional is covered.
 * LIMIT: only levels at or inside the limit price are reachable. Whatever
 * those cannot cover would rest on the book at the limit price, and is
 * reported as `restingUsd` rather than treated as slippage.
 */
export async function simulateProposal(venue: ExecutionVenue, proposal: Proposal, navUsd: number): Promise<SimulationResult> {
  const depth: OrderBook = await venue.getDepth(proposal.symbol, 50);
  const levels = proposal.side === "BUY" ? depth.asks : depth.bids;
  if (levels.length === 0) {
    throw new Error(`No ${proposal.side === "BUY" ? "ask" : "bid"} liquidity available for ${proposal.symbol}`);
  }

  const isLimit = proposal.type === "LIMIT";
  const referencePrice = levels[0]!.price;
  const limitPrice = proposal.limitPrice ?? referencePrice;

  const notionalUsd = isLimit ? (proposal.quantity ?? 0) * limitPrice : (proposal.quoteOrderQty ?? (proposal.quantity ?? 0) * referencePrice);

  // A limit order can only take liquidity that is at or better than its price.
  const reachable = isLimit ? levels.filter((l) => (proposal.side === "BUY" ? l.price <= limitPrice : l.price >= limitPrice)) : levels;

  // Walk the book to find the volume-weighted average fill price.
  let remainingUsd = notionalUsd;
  let filledUsd = 0;
  let filledBaseQty = 0;
  let restingUsd = 0;

  if (isLimit) {
    // A limit order is sized in base units, not dollars. Walking it with a
    // dollar budget would let it buy more units than were asked for whenever
    // the book is cheaper than the limit price.
    let remainingQty = proposal.quantity ?? 0;
    for (const level of reachable) {
      const takeQty = Math.min(remainingQty, level.quantity);
      if (takeQty <= 0) break;
      filledUsd += takeQty * level.price;
      filledBaseQty += takeQty;
      remainingQty -= takeQty;
      if (remainingQty <= 0) break;
    }
    restingUsd = Math.max(0, remainingQty) * limitPrice;
    remainingUsd = 0;
  } else {
    for (const level of reachable) {
      const levelNotional = level.price * level.quantity;
      const take = Math.min(remainingUsd, levelNotional);
      if (take <= 0) break;
      filledUsd += take;
      filledBaseQty += take / level.price;
      remainingUsd -= take;
      if (remainingUsd <= 0) break;
    }
  }

  const projectedFillPrice = filledBaseQty > 0 ? filledUsd / filledBaseQty : isLimit ? limitPrice : referencePrice;
  const projectedSlippageBps =
    filledBaseQty > 0 && referencePrice > 0
      ? ((projectedFillPrice - referencePrice) / referencePrice) * 10_000 * (proposal.side === "BUY" ? 1 : -1)
      : 0;
  const projectedNavImpactPct = navUsd > 0 ? (notionalUsd / navUsd) * 100 : 0;

  // If the sampled depth ran out before covering a MARKET notional, the numbers
  // above only describe the fillable portion and understate the real impact.
  // liquidityInsufficient/unfilledUsd are the authoritative signal of that, not
  // projectedFillPrice/projectedSlippageBps. For a LIMIT the same shortfall is
  // not a problem, it just rests on the book, and is reported as restingUsd.
  const shortfall = remainingUsd > 0 ? remainingUsd : 0;
  const liquidityInsufficient = shortfall > 0;

  return {
    venue: venue.name,
    referencePrice,
    projectedFillPrice,
    projectedSlippageBps: Math.max(0, projectedSlippageBps),
    notionalUsd,
    projectedNavImpactPct,
    orderBookDepthSampledAt: depth.sampledAt,
    liquidityInsufficient,
    unfilledUsd: liquidityInsufficient ? shortfall : 0,
    restingUsd,
  };
}
