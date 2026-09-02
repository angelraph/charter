import type { ExecutionVenue } from "../venues/types.js";
import { getTickerPrice } from "./binanceRest.js";

/**
 * Approximate NAV in USD, used for dailyDrawdownHaltPct and NAV-impact
 * calculations. Deliberately simple for the hackathon timeline: prices a
 * curated set of major assets via their live *USDT ticker and treats
 * USDT/USDC/BFUSD/FDUSD as $1 — good enough to gate real limits, not a
 * full portfolio valuation engine. Assets outside this set are ignored
 * (documented here rather than hidden) rather than silently mis-priced.
 */
const STABLES = new Set(["USDT", "USDC", "BFUSD", "FDUSD", "TUSD", "USD"]);
const PRICED_ASSETS = ["BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "LTC"];

export async function computeApproxNavUsd(venue: ExecutionVenue, marketBaseUrl: string): Promise<number> {
  const balances = await venue.getSubAccountBalances();
  let navUsd = 0;

  for (const b of balances) {
    const total = b.free + b.locked;
    if (total <= 0) continue;
    if (STABLES.has(b.asset)) {
      navUsd += total;
      continue;
    }
    if (!PRICED_ASSETS.includes(b.asset)) continue;
    try {
      const ticker = await getTickerPrice(marketBaseUrl, `${b.asset}USDT`);
      navUsd += total * ticker.price;
    } catch {
      // No USDT pair for this asset on this venue — skip rather than guess.
    }
  }

  return navUsd;
}
