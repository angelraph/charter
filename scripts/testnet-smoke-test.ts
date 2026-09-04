/**
 * Day 1 deliverable: prove CHARTER is talking to a REAL venue, not mocked
 * data. Prints a real testnet account balance and a real live order book
 * for BTCUSDT, both timestamped so they can be checked against wall clock
 * and against the testnet.binance.vision UI directly.
 */
import { activeVenue, marketDataBaseUrl } from "../src/venues/index.js";
import { getTickerPrice } from "../src/market/binanceRest.js";

async function main() {
  console.log(`\nCHARTER testnet smoke test. Venue: ${activeVenue.name}\n`);

  console.log("[1/3] Fetching real account balances...");
  const balances = await activeVenue.getSubAccountBalances();
  if (balances.length === 0) {
    console.log("  (account has zero balances everywhere, testnet usually seeds BTC/USDT/BNB automatically on signup)");
  } else {
    for (const b of balances) {
      console.log(`  ${b.asset}: free=${b.free} locked=${b.locked}`);
    }
  }

  console.log("\n[2/3] Fetching real live order book depth for BTCUSDT...");
  const depth = await activeVenue.getDepth("BTCUSDT", 5);
  console.log(`  sampled at: ${depth.sampledAt}`);
  console.log(`  best bid: ${depth.bids[0]?.price} x ${depth.bids[0]?.quantity}`);
  console.log(`  best ask: ${depth.asks[0]?.price} x ${depth.asks[0]?.quantity}`);

  console.log("\n[3/3] Fetching real live ticker price for BTCUSDT...");
  const ticker = await getTickerPrice(marketDataBaseUrl(), "BTCUSDT");
  console.log(`  BTCUSDT last price: ${ticker.price}`);

  console.log(`\nDone. Wall clock: ${new Date().toISOString()}. Compare against testnet.binance.vision to verify this is real.\n`);
}

main().catch((err) => {
  console.error("\nSmoke test failed:", err.message ?? err);
  process.exit(1);
});
