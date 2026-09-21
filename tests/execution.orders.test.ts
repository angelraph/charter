import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/audit/log.js", () => ({ auditLog: { append: vi.fn() } }));

import { cancelAllCharterOrders, cancelCharterOrder, listOpenCharterOrders } from "../src/execution/orders.js";
import { auditLog } from "../src/audit/log.js";
import type { ExecutionVenue, OpenOrder, OrderResult } from "../src/venues/types.js";

const mockedAppend = vi.mocked(auditLog.append);

const order = (orderId: string, clientOrderId: string, symbol = "BTCUSDT"): OpenOrder => ({
  orderId,
  symbol,
  side: "BUY",
  type: "LIMIT",
  price: 100,
  origQty: 1,
  executedQty: 0,
  status: "NEW",
  clientOrderId,
  time: 0,
});

function venue(open: OpenOrder[], cancel: (symbol: string, id: string) => Promise<OrderResult>): ExecutionVenue {
  return {
    name: "testnet",
    getSubAccountBalances: async () => [],
    getDepth: async () => {
      throw new Error("unused");
    },
    placeOrder: async () => {
      throw new Error("unused");
    },
    getOrder: async () => {
      throw new Error("unused");
    },
    getOpenOrders: async () => open,
    cancelOrder: cancel,
  };
}

const cancelled = (id: string): OrderResult =>
  ({ venue: "testnet", orderId: id, symbol: "BTCUSDT", side: "BUY", type: "LIMIT", status: "CANCELED", executedQty: 0, cummulativeQuoteQty: 0, fills: [], raw: {} }) as OrderResult;

beforeEach(() => {
  mockedAppend.mockReset();
  mockedAppend.mockResolvedValue({} as never);
});

describe("listOpenCharterOrders", () => {
  it("returns only orders CHARTER placed, never anything else on the account", async () => {
    const v = venue([order("1", "charter-abc"), order("2", "web_manual_order"), order("3", "charter-def")], async () => cancelled("x"));
    const list = await listOpenCharterOrders(v);
    expect(list.map((o) => o.orderId)).toEqual(["1", "3"]);
  });
});

describe("cancelCharterOrder", () => {
  it("cancels on the venue and records who did it and why", async () => {
    const cancel = vi.fn(async (_s: string, id: string) => cancelled(id));
    await cancelCharterOrder(venue([], cancel), "BTCUSDT", "42", "alice", "changed my mind");
    expect(cancel).toHaveBeenCalledWith("BTCUSDT", "42");
    expect(mockedAppend).toHaveBeenCalledWith("ORDER_CANCELLED", "testnet", expect.objectContaining({ orderId: "42", by: "alice", reason: "changed my mind" }));
  });

  it("records nothing if the venue refused the cancel", async () => {
    const cancel = vi.fn(async () => {
      throw new Error("Unknown order");
    });
    await expect(cancelCharterOrder(venue([], cancel), "BTCUSDT", "42", "alice")).rejects.toThrow("Unknown order");
    expect(mockedAppend).not.toHaveBeenCalled();
  });
});

describe("cancelAllCharterOrders", () => {
  it("cancels every CHARTER order and leaves other orders alone", async () => {
    const cancel = vi.fn(async (_s: string, id: string) => cancelled(id));
    const v = venue([order("1", "charter-a"), order("2", "manual"), order("3", "charter-b")], cancel);
    const result = await cancelAllCharterOrders(v, "alice", "halt");
    expect(result.cancelled.map((o) => o.orderId)).toEqual(["1", "3"]);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).not.toHaveBeenCalledWith(expect.anything(), "2");
  });

  it("keeps going when one cancel fails, and reports it", async () => {
    const cancel = vi.fn(async (_s: string, id: string) => {
      if (id === "1") throw new Error("already filled");
      return cancelled(id);
    });
    const v = venue([order("1", "charter-a"), order("2", "charter-b")], cancel);
    const result = await cancelAllCharterOrders(v, "alice");
    expect(result.cancelled.map((o) => o.orderId)).toEqual(["2"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.error).toContain("already filled");
  });
});
