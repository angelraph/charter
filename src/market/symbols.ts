/** Quote assets a spot symbol can end in, longest first so USDT is not read as USD plus a stray T. */
const QUOTES = ["FDUSD", "USDT", "USDC", "TUSD", "BUSD", "USDP", "USD1", "USDE", "USDS", "BTC", "ETH", "BNB", "EUR", "TRY", "BRL", "USD"];

/** BTCUSDT -> BTC. Returns undefined if the symbol does not end in a known quote asset. */
export function baseAssetOf(symbol: string): string | undefined {
  const upper = symbol.toUpperCase();
  for (const quote of QUOTES) {
    if (upper.endsWith(quote) && upper.length > quote.length) return upper.slice(0, upper.length - quote.length);
  }
  return undefined;
}
