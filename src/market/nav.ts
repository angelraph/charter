import type { Balance, ExecutionVenue } from "../venues/types.js";
import { getAllTickerPrices } from "./binanceRest.js";

/** Bump when the way NAV is computed changes, so a baseline from an older method is never compared against a newer number. */
export const NAV_METHOD = "full-v2";

/** Assets treated as one dollar. */
const STABLES = new Set(["USDT", "USDC", "FDUSD", "TUSD", "USDP", "BFUSD", "USD1", "USDE", "USDS", "RLUSD", "XUSD", "USD"]);

/** Quote assets tried, in order, to price something with no direct USDT pair. */
const BRIDGES = ["BTC", "ETH", "BNB"] as const;

export interface PricedHolding {
  asset: string;
  quantity: number;
  usd: number;
  /** How it was priced: "stable", "USDT" for a direct pair, or the bridge asset used. */
  via: string;
}

export interface UnpricedHolding {
  asset: string;
  quantity: number;
}

export interface NavBreakdown {
  navUsd: number;
  priced: PricedHolding[];
  /** Holdings with no route to a dollar price on this venue. Excluded from navUsd, and listed here rather than hidden. */
  unpriced: UnpricedHolding[];
}

/**
 * Values every holding in USD. Stablecoins count as one dollar. Anything
 * else is priced through its USDT pair, or, failing that, through a BTC,
 * ETH, or BNB pair converted via that asset's own USDT price. What cannot
 * be priced is reported in `unpriced` instead of being guessed at or
 * dropped silently.
 */
export function valueHoldings(balances: Balance[], prices: Map<string, number>): NavBreakdown {
  const priced: PricedHolding[] = [];
  const unpriced: UnpricedHolding[] = [];

  for (const b of balances) {
    const quantity = b.free + b.locked;
    if (quantity <= 0) continue;

    if (STABLES.has(b.asset)) {
      priced.push({ asset: b.asset, quantity, usd: quantity, via: "stable" });
      continue;
    }

    const direct = prices.get(`${b.asset}USDT`);
    if (direct !== undefined && direct > 0) {
      priced.push({ asset: b.asset, quantity, usd: quantity * direct, via: "USDT" });
      continue;
    }

    // Fiat currencies are quoted the other way round: USDTTRY is lira per dollar.
    const inverse = prices.get(`USDT${b.asset}`);
    if (inverse !== undefined && inverse > 0) {
      priced.push({ asset: b.asset, quantity, usd: quantity / inverse, via: "1/USDT" });
      continue;
    }

    let bridged: PricedHolding | undefined;
    for (const bridge of BRIDGES) {
      const pair = prices.get(`${b.asset}${bridge}`);
      const bridgeUsd = prices.get(`${bridge}USDT`);
      if (pair !== undefined && pair > 0 && bridgeUsd !== undefined && bridgeUsd > 0) {
        bridged = { asset: b.asset, quantity, usd: quantity * pair * bridgeUsd, via: bridge };
        break;
      }
    }
    if (bridged) priced.push(bridged);
    else unpriced.push({ asset: b.asset, quantity });
  }

  return { navUsd: priced.reduce((sum, h) => sum + h.usd, 0), priced, unpriced };
}

export async function computeNavBreakdown(venue: ExecutionVenue, marketBaseUrl: string): Promise<NavBreakdown> {
  const [balances, prices] = await Promise.all([venue.getSubAccountBalances(), getAllTickerPrices(marketBaseUrl)]);
  return valueHoldings(balances, prices);
}

export async function computeApproxNavUsd(venue: ExecutionVenue, marketBaseUrl: string): Promise<number> {
  return (await computeNavBreakdown(venue, marketBaseUrl)).navUsd;
}
