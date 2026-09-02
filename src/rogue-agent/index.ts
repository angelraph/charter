import "dotenv/config";
import chalk from "chalk";

/**
 * A genuinely separate OS process pretending to be an unruly trading
 * agent. It only ever talks to CHARTER's HTTP API — never touches the
 * venue directly, never imports CHARTER's internals — so its rejections
 * are as real as any other agent's would be. Fires a mix of proposals
 * that comply with the demo mandate and ones deliberately designed to
 * violate it.
 */

const PORT = process.env.CHARTER_API_PORT ?? "4477";
const BASE_URL = `http://localhost:${PORT}`;
const MANDATE_ID = process.env.CHARTER_DEMO_MANDATE_ID ?? "b2f1e9a0-1a2b-4c3d-8e4f-000000000001";

interface RogueProposal {
  label: string;
  symbol: string;
  side: "BUY" | "SELL";
  usd: number;
  execute: boolean;
}

// Mix of in-policy and deliberately violating proposals against demo-mandate.json
// (perTradeMaxUsd: 50, allowedSymbols: BTCUSDT/ETHUSDT, allowedSides: BUY only).
const SCRIPT: RogueProposal[] = [
  { label: "reasonable BTC buy", symbol: "BTCUSDT", side: "BUY", usd: 12, execute: true },
  { label: "oversized BTC buy (2x perTradeMax)", symbol: "BTCUSDT", side: "BUY", usd: 100, execute: false },
  { label: "off-mandate symbol (DOGE not allowed)", symbol: "DOGEUSDT", side: "BUY", usd: 20, execute: false },
  { label: "disallowed side (SELL not permitted)", symbol: "ETHUSDT", side: "SELL", usd: 10, execute: false },
  { label: "reasonable ETH buy", symbol: "ETHUSDT", side: "BUY", usd: 10, execute: true },
  { label: "way oversized (10x perTradeMax)", symbol: "BTCUSDT", side: "BUY", usd: 500, execute: false },
];

async function proposeOnce(p: RogueProposal): Promise<void> {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "rogue-agent-01",
        mandateId: MANDATE_ID,
        symbol: p.symbol,
        side: p.side,
        usd: p.usd,
        reason: p.label,
        execute: p.execute,
      }),
    });
    const json = (await res.json()) as { proposalId: string; verdict: { decision: string; reasons: Array<{ rule: string; outcome: string; detail: string }> }; execution: unknown };
    const ms = Date.now() - started;

    const color = json.verdict.decision === "PASS" ? chalk.green : json.verdict.decision === "VETO" ? chalk.red : chalk.yellow;
    console.log(color(`[rogue-agent] ${p.label} -> ${json.verdict.decision} (${ms}ms)`));
    const violated = json.verdict.reasons.filter((r) => r.outcome !== "ok");
    for (const r of violated) console.log(chalk.dim(`    ${r.rule}: ${r.detail}`));
    if (json.execution) {
      const ex = json.execution as { orderId: string; status: string };
      console.log(chalk.green(`    real fill: orderId=${ex.orderId} status=${ex.status}`));
    }
  } catch (err) {
    console.error(chalk.red(`[rogue-agent] ${p.label} -> request failed: ${err instanceof Error ? err.message : err}`));
  }
}

async function main() {
  console.log(chalk.bold(`\nrogue-agent demo: talking to CHARTER at ${BASE_URL}\n`));
  console.log("Make sure `charter serve` and `charter init` have both run first.\n");

  for (const p of SCRIPT) {
    await proposeOnce(p);
    await new Promise((r) => setTimeout(r, 2500));
  }

  console.log(chalk.bold("\nrogue-agent run complete."));
}

main();
