import { createHmac } from "node:crypto";
import type {
  Balance,
  ExecutionVenue,
  OpenOrder,
  OrderBook,
  OrderRequest,
  OrderResult,
} from "./types.js";
import { parseFilters, roundDownToStep, type SymbolFilters } from "./filters.js";

/**
 * Real, authenticated client against Binance Spot Testnet
 * (https://testnet.binance.vision), a genuine order-matching engine with
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

  /** Exchange clock minus local clock, in ms. Signed requests are rejected if their timestamp drifts too far from the exchange's. */
  private timeOffsetMs = 0;
  private timeSynced = false;

  private async syncTime(): Promise<void> {
    const before = Date.now();
    const res = await fetch(`${this.baseUrl}/api/v3/time`);
    const after = Date.now();
    if (!res.ok) throw new Error(`Testnet time fetch failed: ${res.status} ${res.statusText}`);
    const { serverTime } = (await res.json()) as { serverTime: number };
    // Assume the server stamped the time halfway through the round trip.
    this.timeOffsetMs = serverTime - Math.round((before + after) / 2);
    this.timeSynced = true;
  }

  private sign(params: Record<string, string | number>): URLSearchParams {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) search.set(k, String(v));
    search.set("timestamp", String(Date.now() + this.timeOffsetMs));
    search.set("recvWindow", "10000");
    const signature = createHmac("sha256", this.apiSecret).update(search.toString()).digest("hex");
    search.set("signature", signature);
    return search;
  }

  private filterCache = new Map<string, SymbolFilters>();

  private async getFilters(symbol: string): Promise<SymbolFilters> {
    const cached = this.filterCache.get(symbol);
    if (cached) return cached;
    const res = await fetch(`${this.baseUrl}/api/v3/exchangeInfo?symbol=${symbol}`);
    if (!res.ok) throw new Error(`Testnet exchangeInfo failed for ${symbol}: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { symbols?: Array<{ filters: Parameters<typeof parseFilters>[0] }> };
    const first = json.symbols?.[0];
    if (!first) throw new Error(`Testnet has no symbol ${symbol}`);
    const filters = parseFilters(first.filters);
    this.filterCache.set(symbol, filters);
    return filters;
  }

  private async signedRequest<T>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number> = {}): Promise<T> {
    if (!this.timeSynced) await this.syncTime();

    for (let attempt = 0; ; attempt++) {
      const search = this.sign(params);
      const url = `${this.baseUrl}${path}?${search.toString()}`;
      const res = await fetch(url, {
        method,
        headers: { "X-MBX-APIKEY": this.apiKey },
      });
      if (res.ok) return (await res.json()) as T;

      const body = await res.text();
      // -1021: the timestamp fell outside the accepted window. The clocks have
      // drifted since the last sync, so resync once and try again. This is
      // safe to retry: a rejected request was never executed.
      if (attempt === 0 && body.includes('"code":-1021')) {
        await this.syncTime();
        continue;
      }
      throw new Error(`Testnet ${method} ${path} failed: ${res.status} ${res.statusText}: ${body}`);
    }
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
      else if (order.quantity !== undefined) params.quantity = roundDownToStep(order.quantity, (await this.getFilters(order.symbol)).stepSize);
      else throw new Error("MARKET order requires quantity or quoteOrderQty");
    } else {
      if (order.quantity === undefined || order.limitPrice === undefined) {
        throw new Error("LIMIT order requires quantity and limitPrice");
      }
      // Round to what the exchange accepts. Quantity only ever rounds down, so
      // the order is never larger than what was approved.
      const filters = await this.getFilters(order.symbol);
      const quantity = roundDownToStep(order.quantity, filters.stepSize);
      const price = roundDownToStep(order.limitPrice, filters.tickSize);
      if (quantity <= 0 || quantity < filters.minQty) {
        throw new Error(`Quantity ${order.quantity} rounds to ${quantity}, below the ${order.symbol} minimum of ${filters.minQty}`);
      }
      if (filters.minNotional > 0 && quantity * price < filters.minNotional) {
        throw new Error(`Order value ${(quantity * price).toFixed(2)} is below the ${order.symbol} minimum of ${filters.minNotional}`);
      }
      params.quantity = quantity;
      params.price = price;
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

  async getOpenOrders(symbol?: string): Promise<OpenOrder[]> {
    const raw = await this.signedRequest<
      Array<{
        orderId: number;
        symbol: string;
        side: "BUY" | "SELL";
        type: string;
        price: string;
        origQty: string;
        executedQty: string;
        status: string;
        clientOrderId: string;
        time: number;
      }>
    >("GET", "/api/v3/openOrders", symbol ? { symbol } : {});
    return raw.map((o) => ({
      orderId: String(o.orderId),
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      price: parseFloat(o.price),
      origQty: parseFloat(o.origQty),
      executedQty: parseFloat(o.executedQty),
      status: o.status,
      clientOrderId: o.clientOrderId,
      time: o.time,
    }));
  }

  async cancelOrder(symbol: string, orderId: string): Promise<OrderResult> {
    const raw = await this.signedRequest<{
      orderId: number;
      symbol: string;
      side: "BUY" | "SELL";
      type: string;
      status: string;
      executedQty: string;
      cummulativeQuoteQty: string;
    }>("DELETE", "/api/v3/order", { symbol, orderId });
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
