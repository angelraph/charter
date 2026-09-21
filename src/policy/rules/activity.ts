import type { Mandate } from "../../mandate/schema.js";
import type { Proposal, RuleResult, SimulationResult } from "../types.js";
import type { AuditEntry } from "../../audit/log.js";

/**
 * Rules that depend on what has already been executed. All of them read the
 * audit log rather than keep counters, so they cannot drift from the record.
 * A proposal counts as executed once an order was filled or placed on the
 * book, since a resting order can still fill later.
 */

interface Committed {
  at: number;
  agentId?: string;
  symbol?: string;
  notionalUsd: number;
}

function committedExecutions(entries: AuditEntry[]): Committed[] {
  const out: Committed[] = [];
  for (const e of entries) {
    if (e.type !== "EXECUTION_FILLED" && e.type !== "EXECUTION_PLACED") continue;
    const p = e.payload as { agentId?: string; symbol?: string; notionalUsd?: number };
    out.push({ at: new Date(e.timestamp).getTime(), agentId: p.agentId, symbol: p.symbol, notionalUsd: p.notionalUsd ?? 0 });
  }
  return out;
}

function startOfUtcDay(now: Date): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export function checkPerSymbolDailyCap(proposal: Proposal, mandate: Mandate, simulation: SimulationResult, entries: AuditEntry[], now: Date): RuleResult {
  const cap = mandate.limits.perSymbolDailyCapUsd;
  if (cap === undefined) return { rule: "perSymbolDailyCapUsd", outcome: "ok", detail: "No per-symbol daily cap configured" };

  const dayStart = startOfUtcDay(now);
  const spent = committedExecutions(entries)
    .filter((c) => c.symbol === proposal.symbol && c.at >= dayStart)
    .reduce((sum, c) => sum + c.notionalUsd, 0);
  const projected = spent + simulation.notionalUsd;

  if (projected > cap) {
    return {
      rule: "perSymbolDailyCapUsd",
      outcome: "violated",
      detail: `${proposal.symbol} already has $${spent.toFixed(2)} today, and this $${simulation.notionalUsd.toFixed(2)} would make $${projected.toFixed(2)}, over the $${cap} per-symbol daily cap`,
    };
  }
  return { rule: "perSymbolDailyCapUsd", outcome: "ok", detail: `${proposal.symbol} would be at $${projected.toFixed(2)} of its $${cap} daily cap` };
}

export function checkTradeRate(proposal: Proposal, mandate: Mandate, entries: AuditEntry[], now: Date): RuleResult {
  const max = mandate.limits.maxTradesPerHour;
  if (max === undefined) return { rule: "maxTradesPerHour", outcome: "ok", detail: "No trade-rate limit configured" };

  const since = now.getTime() - 3_600_000;
  const recent = committedExecutions(entries).filter((c) => c.agentId === proposal.agentId && c.at >= since).length;

  if (recent >= max) {
    return {
      rule: "maxTradesPerHour",
      outcome: "violated",
      detail: `${proposal.agentId} has already executed ${recent} trade${recent === 1 ? "" : "s"} in the last hour, at the limit of ${max}`,
    };
  }
  return { rule: "maxTradesPerHour", outcome: "ok", detail: `${proposal.agentId} has executed ${recent} of ${max} allowed trades in the last hour` };
}

export function checkCooldown(proposal: Proposal, mandate: Mandate, entries: AuditEntry[], now: Date): RuleResult {
  const seconds = mandate.limits.cooldownSeconds;
  if (seconds === undefined) return { rule: "cooldownSeconds", outcome: "ok", detail: "No cooldown configured" };

  const last = committedExecutions(entries)
    .filter((c) => c.agentId === proposal.agentId && c.symbol === proposal.symbol)
    .reduce<number | undefined>((latest, c) => (latest === undefined || c.at > latest ? c.at : latest), undefined);

  if (last !== undefined) {
    const elapsed = (now.getTime() - last) / 1000;
    if (elapsed < seconds) {
      return {
        rule: "cooldownSeconds",
        outcome: "violated",
        detail: `${proposal.agentId} traded ${proposal.symbol} ${elapsed.toFixed(0)}s ago, and the cooldown is ${seconds}s (${(seconds - elapsed).toFixed(0)}s left)`,
      };
    }
  }
  return { rule: "cooldownSeconds", outcome: "ok", detail: `Past the ${seconds}s cooldown for ${proposal.agentId} in ${proposal.symbol}` };
}
