#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./cli/commands/init.js";
import { proposeCommand } from "./cli/commands/propose.js";
import { auditTailCommand, auditVerifyCommand } from "./cli/commands/audit.js";

const program = new Command();

program.name("charter").description("CHARTER — a mandate/policy layer that vets AI agent trade proposals before execution.").version("0.1.0");

program
  .command("init")
  .description("Activate the demo mandate (covenant -> live policy)")
  .action(async () => {
    await initCommand();
  });

program
  .command("propose")
  .description("Submit a trade proposal for a PASS/VETO/ESCALATE verdict, optionally executing it")
  .argument("<symbol>", "e.g. BTCUSDT")
  .argument("<side>", "BUY or SELL")
  .requiredOption("--usd <amount>", "notional size in USD (quote asset)", parseFloat)
  .option("--mandate <id>", "mandate id", "b2f1e9a0-1a2b-4c3d-8e4f-000000000001")
  .option("--agent <id>", "identifier of the agent making the proposal", "cli-operator")
  .option("--execute", "actually place the real order on a PASS/confirmed ESCALATE verdict", false)
  .action(async (symbol: string, side: string, opts: { usd: number; mandate: string; agent: string; execute: boolean }) => {
    if (side !== "BUY" && side !== "SELL") {
      console.error("side must be BUY or SELL");
      process.exit(1);
    }
    await proposeCommand({
      symbol: symbol.toUpperCase(),
      side,
      usd: opts.usd,
      mandateId: opts.mandate,
      agentId: opts.agent,
      execute: opts.execute,
    });
  });

const audit = program.command("audit").description("Inspect the hash-chained audit log");

audit
  .command("tail")
  .description("Show the last N audit entries")
  .argument("[n]", "number of entries", "20")
  .action(async (n: string) => {
    await auditTailCommand(parseInt(n, 10));
  });

audit
  .command("verify")
  .description("Verify the audit log's hash chain is intact")
  .action(async () => {
    await auditVerifyCommand();
  });

program.parseAsync(process.argv);
