import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({
  entries: [] as Array<{ seq: number; timestamp: string; type: string; venue: string; payload: unknown; prevHash: string; hash: string }>,
}));

vi.mock("../src/audit/log.js", () => ({
  auditLog: {
    all: vi.fn(async () => [...store.entries]),
    append: vi.fn(async (type: string, venue: string, payload: unknown) => {
      store.entries.push({ seq: store.entries.length, timestamp: new Date().toISOString(), type, venue, payload, prevHash: "x", hash: "y" });
    }),
  },
}));
vi.mock("../src/market/nav.js", () => ({ NAV_METHOD: "full-v2", computeApproxNavUsd: vi.fn() }));

import { getOrCreateStartOfDayNav } from "../src/mandate/navSnapshot.js";
import { computeApproxNavUsd } from "../src/market/nav.js";
import type { ExecutionVenue } from "../src/venues/types.js";

const venue = { name: "testnet" } as ExecutionVenue;
const mockedNav = vi.mocked(computeApproxNavUsd);

const snapshot = (navUsd: number, method?: string) => {
  store.entries.push({ seq: store.entries.length, timestamp: new Date().toISOString(), type: "NAV_SNAPSHOT", venue: "testnet", payload: { navUsd, ...(method ? { method } : {}) }, prevHash: "x", hash: "y" });
};

beforeEach(() => {
  store.entries.length = 0;
  mockedNav.mockReset();
});

describe("getOrCreateStartOfDayNav", () => {
  it("records today's baseline on first use, tagged with the NAV method", async () => {
    mockedNav.mockResolvedValue(1000);
    expect(await getOrCreateStartOfDayNav(venue, "x")).toBe(1000);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]!.payload).toMatchObject({ navUsd: 1000, method: "full-v2" });
  });

  it("reuses today's baseline instead of recomputing it", async () => {
    snapshot(500, "full-v2");
    expect(await getOrCreateStartOfDayNav(venue, "x")).toBe(500);
    expect(mockedNav).not.toHaveBeenCalled();
    expect(store.entries).toHaveLength(1);
  });

  it("ignores a baseline taken with an older NAV method, so two methods are never compared", async () => {
    snapshot(138_000); // recorded before the method was versioned
    mockedNav.mockResolvedValue(436_000);
    expect(await getOrCreateStartOfDayNav(venue, "x")).toBe(436_000);
    expect(store.entries).toHaveLength(2);
  });

  it("ignores a baseline tagged with some other method", async () => {
    snapshot(1, "curated-v1");
    mockedNav.mockResolvedValue(2000);
    expect(await getOrCreateStartOfDayNav(venue, "x")).toBe(2000);
  });
});
