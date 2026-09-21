import { z } from "zod";

/**
 * A Mandate is the compiled, machine-enforceable form of a human's
 * plain-English covenant ("max 2% of NAV per order, no leverage outside
 * BTC/ETH, halt at -5% drawdown..."). Nothing executes without one.
 */
export const MandateLimitsSchema = z.object({
  perTradeMaxUsd: z.number().positive(),
  dailySpendCapUsd: z.number().positive(),
  maxLeverage: z.number().min(1).max(125),
  dailyDrawdownHaltPct: z.number().min(0).max(100),
  confirmAboveUsd: z.number().positive(),
  allowedSymbols: z.array(z.string()).optional(),
  blockedSymbols: z.array(z.string()).optional(),
  allowedSides: z.array(z.enum(["BUY", "SELL"])).optional(),
  maxSlippageBps: z.number().positive().optional(),
  /** Cap on total notional per symbol per UTC day, across all agents. */
  perSymbolDailyCapUsd: z.number().positive().optional(),
  /** Most trades one agent may have executed in any rolling hour. */
  maxTradesPerHour: z.number().int().positive().optional(),
  /** Minimum seconds between two executed trades by the same agent in the same symbol. */
  cooldownSeconds: z.number().positive().optional(),
  /** Most CHARTER-placed limit orders that may be resting on the book at once. */
  maxOpenOrders: z.number().int().positive().optional(),
  /** A limit price further than this from the market is refused as a likely fat-finger. Defaults to 5. */
  maxLimitDeviationPct: z.number().positive().max(100).optional(),
});

export const MandateSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  owner: z.string().min(1),
  createdAt: z.string().datetime(),
  subAccountId: z.string().min(1),
  naturalLanguageSource: z.string().min(1),
  limits: MandateLimitsSchema,
  status: z.enum(["draft", "active", "suspended"]),
});

export type MandateLimits = z.infer<typeof MandateLimitsSchema>;
export type Mandate = z.infer<typeof MandateSchema>;
