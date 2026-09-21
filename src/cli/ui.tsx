import React, { useEffect, useState } from "react";
import { render, Box, Text } from "ink";
import { activeVenue, marketDataBaseUrl } from "../venues/index.js";
import { computeApproxNavUsd } from "../market/nav.js";
import { auditLog, type AuditEntry } from "../audit/log.js";
import { loadMandate } from "../mandate/store.js";
import type { Mandate } from "../mandate/schema.js";
import { deriveApprovals, deriveKillSwitch, type ApprovalRecord, type KillSwitchState } from "../approval/state.js";

const DEMO_MANDATE_ID = "b2f1e9a0-1a2b-4c3d-8e4f-000000000001";
const POLL_MS = 4000;

function decisionColor(decision: string): string {
  if (decision === "PASS") return "green";
  if (decision === "VETO") return "red";
  if (decision === "ESCALATE") return "yellow";
  return "white";
}

function verdictLine(e: AuditEntry): { text: string; color: string } | null {
  if (e.type !== "VERDICT_ISSUED") return null;
  const payload = e.payload as { verdict: { decision: string; proposalId: string; simulation: { notionalUsd: number } } };
  return {
    text: `#${e.seq} ${e.timestamp.slice(11, 19)}  ${payload.verdict.decision.padEnd(8)} $${payload.verdict.simulation.notionalUsd.toFixed(2).padStart(8)}  proposal ${payload.verdict.proposalId.slice(0, 8)}`,
    color: decisionColor(payload.verdict.decision),
  };
}

function fillLine(e: AuditEntry): string | null {
  if (e.type !== "EXECUTION_FILLED" && e.type !== "EXECUTION_PLACED") return null;
  const p = e.payload as { orderId: string; symbol: string; side: string; executedQty: number; notionalUsd: number };
  return `#${e.seq} ${e.timestamp.slice(11, 19)}  ${e.type === "EXECUTION_PLACED" ? "RESTING" : "FILLED "}  ${p.side} ${p.executedQty} ${p.symbol}  ($${p.notionalUsd.toFixed(2)})  order ${p.orderId}`;
}

const App: React.FC = () => {
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [navUsd, setNavUsd] = useState<number | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [killSwitch, setKillSwitch] = useState<KillSwitchState>({ engaged: false });
  const [pending, setPending] = useState<ApprovalRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [m, nav, all] = await Promise.all([
          loadMandate(DEMO_MANDATE_ID).catch(() => null),
          computeApproxNavUsd(activeVenue, marketDataBaseUrl()),
          auditLog.all(),
        ]);
        if (cancelled) return;
        setMandate(m);
        setNavUsd(nav);
        setEntries(all.slice(-15));
        setKillSwitch(deriveKillSwitch(all));
        setPending([...deriveApprovals(all).values()].filter((r) => r.status === "pending"));
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    poll();
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      poll();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const verdicts = entries.map(verdictLine).filter((v): v is { text: string; color: string } => v !== null);
  const fills = entries.map(fillLine).filter((f): f is string => f !== null);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        CHARTER ops console ({activeVenue.name}), refresh #{tick}
      </Text>
      <Text dimColor>Nothing reaches Binance until it survives your charter.</Text>
      <Box marginTop={1} flexDirection="column">
        {error && <Text color="red">Error: {error}</Text>}
        {killSwitch.engaged && (
          <Box borderStyle="bold" borderColor="red" paddingX={1} marginBottom={1}>
            <Text bold color="red">
              TRADING HALTED{killSwitch.by ? ` by ${killSwitch.by}` : ""}{killSwitch.reason ? `: ${killSwitch.reason}` : ""}. Every proposal is vetoed until released.
            </Text>
          </Box>
        )}
        {pending.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
            <Text bold color="yellow">Waiting on a human ({pending.length})</Text>
            {pending.map((r) => (
              <Text key={r.approvalId} color="yellow">
                {r.approvalId.slice(0, 8)}  {r.proposal.side} ${r.verdict.simulation.notionalUsd.toFixed(2)} {r.proposal.symbol}  from {r.proposal.agentId}  expires {r.expiresAt.slice(11, 19)}
              </Text>
            ))}
          </Box>
        )}
        {mandate && (
          <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
            <Text bold>Mandate {mandate.id.slice(0, 8)} ({mandate.status})</Text>
            <Text>
              perTradeMax ${mandate.limits.perTradeMaxUsd}  dailyCap ${mandate.limits.dailySpendCapUsd}  confirmAbove ${mandate.limits.confirmAboveUsd}  drawdownHalt {mandate.limits.dailyDrawdownHaltPct}%
            </Text>
            <Text dimColor>symbols: {mandate.limits.allowedSymbols?.join(", ") ?? "any"} | sides: {mandate.limits.allowedSides?.join(", ") ?? "any"}</Text>
          </Box>
        )}
        <Box marginBottom={1}>
          <Text>
            Approx NAV: <Text bold color="green">{navUsd !== null ? `$${navUsd.toFixed(2)}` : "…"}</Text>
          </Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} marginBottom={1}>
          <Text bold>Verdict feed (last {verdicts.length})</Text>
          {verdicts.length === 0 && <Text dimColor>No verdicts yet. Run `charter propose` or the rogue-agent.</Text>}
          {verdicts.map((v, i) => (
            <Text key={i} color={v.color}>
              {v.text}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
          <Text bold>Real fills (last {fills.length})</Text>
          {fills.length === 0 && <Text dimColor>No fills yet.</Text>}
          {fills.map((f, i) => (
            <Text key={i} color="green">
              {f}
            </Text>
          ))}
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Ctrl+C to exit. Polling every {POLL_MS / 1000}s from the real audit log + live venue.</Text>
      </Box>
    </Box>
  );
};

export function startDashboard(): void {
  render(<App />);
}
