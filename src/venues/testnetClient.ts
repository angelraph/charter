import { createHmac } from "node:crypto";
import type {
  Balance,
  ExecutionVenue,
  OrderBook,
  OrderRequest,
  OrderResult,
} from "./types.js";

/**
 * Real, authenticated client against Binance Spot Testnet
 * (https://testnet.binance.vision) — a genuine order-matching engine with
 * virtual funds. Same signed-REST shape as production Binance Spot API,
 * just a different base URL and API key pair. Get keys by logging into
 * https://testnet.binance.vision with GitHub.
 */
export class TestnetClient implements ExecutionVenue {
  readonly name = "testnet" as const;

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly baseUrl: string
  ) {}

  private sign(params: Record<string, string | number>): URLSearchParams {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) search.set(k, String(v));
    search.set("timestamp", String(Date.now()));
    search.set("recvWindow", "5000");
    const signature = createHmac("sha256", this.apiSecret).update(search.toString()).digest("hex");
    search.set("signature", signature);
    return search;
  }

  private async signedRequest<T>(method: "GET" | "POST", path: string, params: Record<string, string | number> = {}): Promise<T> {
    const search = this.sign(params);
    const url = `${this.baseUrl}${path}?${search.toString()}`;
    const res = await fetch(url, {
      method,
      headers: { "X-MBX-APIKEY": this.apiKey },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Testnet ${method} ${path} failed: ${res.status} ${res.statusText} — ${body}`);
    }
    return (await res.json()) as T;
  }

  async getSubAccountBalances(): Promise<Balance[]> {
    const account = await this.signedRequest<{ balances: Array<{ asset: string; free: string; locked: string }> }>(
      "GET",
      "/api/v3/account"
    );
    return account.balances
      .map((b) => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) }))
      .filter((b) => b.free > 0 || b.locked > 0);
  }

  async getDepth(symbol: string, limit = 20): Promise<OrderBook> {
    const res = await fetch(`${this.baseUrl}/api/v3/depth?symbol=${symbol}&limit=${limit}`);
    if (!res.ok) throw new Error(`Testnet depth fetch failed: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { bids: [string, string][]; asks: [string, string][] };
    return {
      symbol,
      bids: json.bids.map(([price, quantity]) => ({ price: parseFloat(price), quantity: parseFloat(quantity) })),
      asks: json.asks.map(([price, quantity]) => ({ price: parseFloat(price), quantity: parseFloat(quantity) })),
      sampledAt: new Date().toISOString(),
    };
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    const params: Record<string, string | number> = {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
    };
    if (order.type === "MARKET") {
      if (order.quoteOrderQty !== undefined) params.quoteOrderQty = order.quoteOrderQty;
      else if (order.quantity !== undefined) params.quantity = order.quantity;
      else throw new Error("MARKET order requires quantity or quoteOrderQty");
    } else {
      if (order.quantity === undefined || order.limitPrice === undefined) {
        throw new Error("LIMIT order requires quantity and limitPrice");
      }
      params.quantity = order.quantity;
      params.price = order.limitPrice;
      params.timeInForce = "GTC";
    }
    if (order.clientOrderId) params.newClientOrderId = order.clientOrderId;

    const raw = await this.signedRequest<{
      orderId: number;
      symbol: string;
      side: "BUY" | "SELL";
      type: string;
      status: string;
      executedQty: string;
      cummulativeQuoteQty: string;
      fills?: Array<{ price: string; qty: string; commission: string; commissionAsset: string }>;
    }>("POST", "/api/v3/order", params);

    return {
      venue: this.name,
      orderId: String(raw.orderId),
      symbol: raw.symbol,
      side: raw.side,
      type: order.type,
      status: raw.status,
      executedQty: parseFloat(raw.executedQty),
      cummulativeQuoteQty: parseFloat(raw.cummulativeQuoteQty),
      fills: (raw.fills ?? []).map((f) => ({
        price: parseFloat(f.price),
        qty: parseFloat(f.qty),
        commission: parseFloat(f.commission),
        commissionAsset: f.commissionAsset,
      })),
      raw,
    };
  }

  async getOrder(symbol: string, orderId: string): Promise<OrderResult> {
    const raw = await this.signedRequest<{
      orderId: number;
      symbol: string;
      side: "BUY" | "SELL";
      type: string;
      status: string;
      executedQty: string;
      cummulativeQuoteQty: string;
    }>("GET", "/api/v3/order", { symbol, orderId });

    return {
      venue: this.name,
      orderId: String(raw.orderId),
      symbol: raw.symbol,
      side: raw.side,
      type: raw.type as "MARKET" | "LIMIT",
      status: raw.status,
      executedQty: parseFloat(raw.executedQty),
      cummulativeQuoteQty: parseFloat(raw.cummulativeQuoteQty),
      fills: [],
      raw,
    };
  }
}
