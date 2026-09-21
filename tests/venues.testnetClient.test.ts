import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TestnetClient } from "../src/venues/testnetClient.js";

const BASE = "https://testnet.example";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const timeReply = (serverTime: number) => json({ serverTime });

let calls: Array<{ url: string; method: string }>;
let responder: (url: string, method: string) => Response;

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      return responder(url, method);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = () => new TestnetClient("key", "secret", BASE);
const accountBody = { balances: [{ asset: "USDT", free: "10.5", locked: "0" }] };

describe("TestnetClient clock handling", () => {
  it("syncs to the exchange clock before its first signed request", async () => {
    responder = (url) => (url.includes("/api/v3/time") ? timeReply(Date.now()) : json(accountBody));
    await client().getSubAccountBalances();
    expect(calls[0]!.url).toContain("/api/v3/time");
    expect(calls[1]!.url).toContain("/api/v3/account");
  });

  it("stamps requests with the exchange's time, not the local clock", async () => {
    const skew = 60_000;
    responder = (url) => (url.includes("/api/v3/time") ? timeReply(Date.now() + skew) : json(accountBody));
    await client().getSubAccountBalances();
    const stamp = Number(new URL(calls[1]!.url).searchParams.get("timestamp"));
    expect(Math.abs(stamp - (Date.now() + skew))).toBeLessThan(5_000);
  });

  it("syncs only once across several requests", async () => {
    responder = (url) => (url.includes("/api/v3/time") ? timeReply(Date.now()) : json(accountBody));
    const c = client();
    await c.getSubAccountBalances();
    await c.getSubAccountBalances();
    expect(calls.filter((x) => x.url.includes("/api/v3/time"))).toHaveLength(1);
  });

  it("on a timestamp rejection (-1021) resyncs and retries once, then succeeds", async () => {
    let accountCalls = 0;
    responder = (url) => {
      if (url.includes("/api/v3/time")) return timeReply(Date.now());
      accountCalls++;
      return accountCalls === 1 ? json({ code: -1021, msg: "Timestamp for this request is outside of the recvWindow." }, 400) : json(accountBody);
    };
    const balances = await client().getSubAccountBalances();
    expect(balances[0]!.asset).toBe("USDT");
    expect(accountCalls).toBe(2);
    expect(calls.filter((x) => x.url.includes("/api/v3/time"))).toHaveLength(2);
  });

  it("gives up after one retry rather than looping forever", async () => {
    responder = (url) => (url.includes("/api/v3/time") ? timeReply(Date.now()) : json({ code: -1021, msg: "outside of the recvWindow" }, 400));
    await expect(client().getSubAccountBalances()).rejects.toThrow("-1021");
    expect(calls.filter((x) => x.url.includes("/api/v3/account"))).toHaveLength(2);
  });

  it("does not retry an unrelated error", async () => {
    responder = (url) => (url.includes("/api/v3/time") ? timeReply(Date.now()) : json({ code: -2010, msg: "Account has insufficient balance" }, 400));
    await expect(client().getSubAccountBalances()).rejects.toThrow("insufficient balance");
    expect(calls.filter((x) => x.url.includes("/api/v3/account"))).toHaveLength(1);
  });
});

describe("TestnetClient limit orders", () => {
  const exchangeInfo = {
    symbols: [
      {
        filters: [
          { filterType: "PRICE_FILTER", tickSize: "0.01000000" },
          { filterType: "LOT_SIZE", stepSize: "0.00001000", minQty: "0.00001000" },
          { filterType: "NOTIONAL", minNotional: "5.00000000" },
        ],
      },
    ],
  };
  const orderReply = { orderId: 7, symbol: "BTCUSDT", side: "BUY", type: "LIMIT", status: "NEW", executedQty: "0", cummulativeQuoteQty: "0" };

  function orderResponder() {
    responder = (url) => {
      if (url.includes("/api/v3/time")) return timeReply(Date.now());
      if (url.includes("/api/v3/exchangeInfo")) return json(exchangeInfo);
      return json(orderReply);
    };
  }

  const sentParams = () => new URL(calls.find((c) => c.url.includes("/api/v3/order"))!.url).searchParams;

  it("rounds quantity down and price to the exchange's step and tick sizes", async () => {
    orderResponder();
    await client().placeOrder({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: 0.000219999, limitPrice: 80030.129 });
    const p = sentParams();
    expect(p.get("quantity")).toBe("0.00021");
    expect(p.get("price")).toBe("80030.12");
    expect(p.get("timeInForce")).toBe("GTC");
  });

  it("refuses a quantity that rounds below the minimum, instead of sending something the exchange will reject", async () => {
    orderResponder();
    await expect(client().placeOrder({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: 0.000001, limitPrice: 80000 })).rejects.toThrow("minimum");
    expect(calls.some((c) => c.url.includes("/api/v3/order"))).toBe(false);
  });

  it("refuses an order below the minimum notional", async () => {
    orderResponder();
    await expect(client().placeOrder({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: 0.00002, limitPrice: 80000 })).rejects.toThrow("below the BTCUSDT minimum");
  });

  it("looks the symbol's filters up once and reuses them", async () => {
    orderResponder();
    const c = client();
    await c.placeOrder({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: 0.0002, limitPrice: 80000 });
    await c.placeOrder({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: 0.0002, limitPrice: 80000 });
    expect(calls.filter((x) => x.url.includes("/api/v3/exchangeInfo"))).toHaveLength(1);
  });

  it("cancels with DELETE", async () => {
    orderResponder();
    await client().cancelOrder("BTCUSDT", "7");
    const del = calls.find((c) => c.method === "DELETE");
    expect(del?.url).toContain("/api/v3/order");
    expect(del?.url).toContain("orderId=7");
  });

  it("reads open orders", async () => {
    responder = (url) =>
      url.includes("/api/v3/time")
        ? timeReply(Date.now())
        : json([{ orderId: 7, symbol: "BTCUSDT", side: "BUY", type: "LIMIT", price: "80000", origQty: "0.0002", executedQty: "0", status: "NEW", clientOrderId: "charter-abc", time: 1 }]);
    const open = await client().getOpenOrders();
    expect(open[0]).toMatchObject({ orderId: "7", price: 80000, origQty: 0.0002, clientOrderId: "charter-abc" });
  });
});
