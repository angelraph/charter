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
  maxOpenPositions: z.number().int().positive().optional(),
  maxSlippageBps: z.number().positive().optional(),
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
