import { describe, it, expect } from "vitest";
import { ProposalSchema } from "../src/policy/types.js";

const base = {
  id: "00000000-0000-0000-0000-000000000002",
  agentId: "a",
  mandateId: "00000000-0000-0000-0000-000000000001",
  symbol: "BTCUSDT",
  side: "BUY",
  submittedAt: new Date().toISOString(),
};

const messages = (input: unknown): string[] => {
  const r = ProposalSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("ProposalSchema", () => {
  it("accepts a MARKET proposal sized in USD", () => {
    expect(ProposalSchema.safeParse({ ...base, type: "MARKET", quoteOrderQty: 15 }).success).toBe(true);
  });

  it("accepts a MARKET proposal sized by quantity", () => {
    expect(ProposalSchema.safeParse({ ...base, type: "MARKET", quantity: 0.001 }).success).toBe(true);
  });

  it("refuses a MARKET proposal with no size", () => {
    expect(messages({ ...base, type: "MARKET" }).join(" ")).toContain("USD amount");
  });

  it("accepts a LIMIT proposal with quantity and price", () => {
    expect(ProposalSchema.safeParse({ ...base, type: "LIMIT", quantity: 0.001, limitPrice: 70000 }).success).toBe(true);
  });

  it("refuses a LIMIT proposal missing its price or its quantity", () => {
    expect(messages({ ...base, type: "LIMIT", quantity: 1 }).join(" ")).toContain("limitPrice");
    expect(messages({ ...base, type: "LIMIT", limitPrice: 1 }).join(" ")).toContain("quantity");
  });

  it("refuses a LIMIT proposal sized in USD, which would be ambiguous", () => {
    expect(messages({ ...base, type: "LIMIT", quantity: 1, limitPrice: 1, quoteOrderQty: 100 }).join(" ")).toContain("not a USD amount");
  });

  it("refuses a non-positive size or price", () => {
    expect(ProposalSchema.safeParse({ ...base, type: "LIMIT", quantity: 0, limitPrice: 1 }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...base, type: "LIMIT", quantity: 1, limitPrice: -5 }).success).toBe(false);
  });
});
