/**
 * Every execution venue CHARTER can point at implements this interface.
 * `execution/adapter.ts` and `market/simulator.ts` depend only on this —
 * never on testnetClient or mcpClient directly — so switching
 * EXECUTION_VENUE from "testnet" to "mainnet-mcp" is a config change,
 * not a rewrite.
 */

export interface Balance {
  asset: string;
  free: number;
  locked: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  sampledAt: string;
}

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity?: number;
  quoteOrderQty?: number;
  limitPrice?: number;
  clientOrderId?: string;
}

export interface OrderResult {
  venue: VenueName;
  orderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: string;
  executedQty: number;
  cummulativeQuoteQty: number;
  fills: Array<{ price: number; qty: number; commission: number; commissionAsset: string }>;
  raw: unknown;
}

export type VenueName = "testnet" | "mainnet-mcp";

export interface ExecutionVenue {
  readonly name: VenueName;
  getSubAccountBalances(): Promise<Balance[]>;
  getDepth(symbol: string, limit?: number): Promise<OrderBook>;
  placeOrder(order: OrderRequest): Promise<OrderResult>;
  getOrder(symbol: string, orderId: string): Promise<OrderResult>;
}
