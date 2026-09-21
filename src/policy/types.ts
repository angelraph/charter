import { z } from "zod";

export const ProposalSchema = z
  .object({
    id: z.string().uuid(),
    agentId: z.string().min(1),
    mandateId: z.string().uuid(),
    symbol: z.string().min(1),
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["MARKET", "LIMIT"]),
    quantity: z.number().positive().optional(),
    quoteOrderQty: z.number().positive().optional(),
    limitPrice: z.number().positive().optional(),
    reason: z.string().optional(),
    submittedAt: z.string().datetime(),
  })
  .superRefine((p, ctx) => {
    if (p.type === "MARKET" && p.quoteOrderQty === undefined && p.quantity === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A MARKET proposal needs a USD amount (quoteOrderQty) or a quantity" });
    }
    if (p.type === "LIMIT") {
      if (p.quantity === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A LIMIT proposal needs a quantity" });
      if (p.limitPrice === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A LIMIT proposal needs a limitPrice" });
      if (p.quoteOrderQty !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A LIMIT proposal is sized by quantity, not a USD amount" });
    }
  });
export type Proposal = z.infer<typeof ProposalSchema>;

export type RuleOutcome = "ok" | "violated" | "warning";

export interface RuleResult {
  rule: string;
  outcome: RuleOutcome;
  detail: string;
}

export type VerdictDecision = "PASS" | "VETO" | "ESCALATE";

export interface SimulationResult {
  venue: string;
  referencePrice: number;
  projectedFillPrice: number;
  projectedSlippageBps: number;
  notionalUsd: number;
  projectedNavImpactPct: number;
  orderBookDepthSampledAt: string;
  /** True when the sampled order-book depth couldn't fully cover notionalUsd. When true, projectedFillPrice/projectedSlippageBps describe only the fillable portion and understate the real impact. */
  liquidityInsufficient: boolean;
  /** Notional not coverable by the sampled depth; 0 when fully covered. Only meaningful for MARKET. */
  unfilledUsd: number;
  /** LIMIT only: notional that would not fill at once and would rest on the book at the limit price. */
  restingUsd: number;
}

export interface Verdict {
  id: string;
  proposalId: string;
  decision: VerdictDecision;
  reasons: RuleResult[];
  simulation: SimulationResult;
  decidedAt: string;
  policyVersion: number;
}
