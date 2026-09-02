import { config } from "../config.js";
import type { ExecutionVenue } from "./types.js";
import { TestnetClient } from "./testnetClient.js";

/**
 * Single place that picks the active venue from config.EXECUTION_VENUE.
 * Everything else in the app (policy simulator, execution adapter, CLI)
 * imports `activeVenue` and never touches a concrete client directly —
 * that's what makes flipping to mainnet-mcp a one-line config change.
 */
function buildVenue(): ExecutionVenue {
  if (config.executionVenue === "testnet") {
    return new TestnetClient(config.testnet.apiKey, config.testnet.apiSecret, config.testnet.baseUrl);
  }
  // mainnet-mcp is implemented in src/venues/mcpClient.ts (Day 5/6 decision point).
  throw new Error(
    "EXECUTION_VENUE=mainnet-mcp is not wired up yet. src/venues/mcpClient.ts is built once real funds and MCP OAuth are confirmed."
  );
}

export const activeVenue: ExecutionVenue = buildVenue();

export function marketDataBaseUrl(): string {
  return config.executionVenue === "testnet" ? config.testnet.baseUrl : "https://api.binance.com";
}
