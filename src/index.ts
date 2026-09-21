#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./cli/commands/init.js";
import { proposeCommand } from "./cli/commands/propose.js";
import { auditTailCommand, auditVerifyCommand } from "./cli/commands/audit.js";
import { mandateCompileCommand } from "./cli/commands/mandate.js";
import { startApiServer } from "./api/server.js";
import { startDashboard } from "./cli/ui.js";
import { agentAddCommand, agentListCommand, agentRevokeCommand, agentRotateCommand } from "./cli/commands/agents.js";
import {
  approvalsListCommand,
  approveCommand,
  cancelCommand,
  controlStatusCommand,
  haltCommand,
  ordersCommand,
  rejectCommand,
  resumeCommand,
} from "./cli/commands/control.js";

const program = new Command();

program.name("charter").description("CHARTER: a mandate/policy layer that vets AI agent trade proposals before execution.").version("0.1.0");

program
  .command("init")
  .description("Activate the demo mandate (covenant -> live policy)")
  .action(async () => {
    await initCommand();
  });

interface ProposeCliOptions {
  usd?: number;
  type: string;
  qty?: number;
  limitPrice?: number;
  mandate: string;
  agent: string;
  execute: boolean;
}

program
  .command("propose")
  .description("Submit a trade proposal for a PASS/VETO/ESCALATE verdict, optionally executing it")
  .argument("<symbol>", "e.g. BTCUSDT")
  .argument("<side>", "BUY or SELL")
  .option("--usd <amount>", "MARKET: how much to trade, in USD", parseFloat)
  .option("--type <type>", "MARKET or LIMIT", "MARKET")
  .option("--qty <amount>", "LIMIT: how much of the asset", parseFloat)
  .option("--limit-price <price>", "LIMIT: the price", parseFloat)
  .option("--mandate <id>", "mandate id", "b2f1e9a0-1a2b-4c3d-8e4f-000000000001")
  .option("--agent <id>", "identifier of the agent making the proposal", "cli-operator")
  .option("--execute", "place the real order if the verdict is PASS (an ESCALATE always waits for a separate approval)", false)
  .action(async (symbol: string, side: string, opts: ProposeCliOptions) => {
    if (side !== "BUY" && side !== "SELL") {
      console.error("side must be BUY or SELL");
      process.exit(1);
    }
    const type = opts.type.toUpperCase();
    if (type !== "MARKET" && type !== "LIMIT") {
      console.error("--type must be MARKET or LIMIT");
      process.exit(1);
    }
    if (type === "MARKET" && opts.usd === undefined) {
      console.error("A MARKET proposal needs --usd");
      process.exit(1);
    }
    if (type === "LIMIT" && (opts.qty === undefined || opts.limitPrice === undefined)) {
      console.error("A LIMIT proposal needs --qty and --limit-price");
      process.exit(1);
    }
    await proposeCommand({
      symbol: symbol.toUpperCase(),
      side,
      type,
      usd: opts.usd,
      quantity: opts.qty,
      limitPrice: opts.limitPrice,
      mandateId: opts.mandate,
      agentId: opts.agent,
      execute: opts.execute,
    });
  });

program
  .command("dashboard")
  .description("Live terminal ops console: mandate, verdict feed, real fills. Polls the real audit log.")
  .action(() => {
    startDashboard();
  });

program
  .command("serve")
  .description("Start the local HTTP API other agents propose against (POST /propose)")
  .action(() => {
    startApiServer();
  });

const mandate = program.command("mandate").description("Manage mandates (covenants compiled into live policy)");

mandate
  .command("compile")
  .description("Compile a plain-English covenant into a draft mandate, then activate it on confirmation")
  .argument("<text>", "the covenant, in plain English")
  .option("--owner <email>", "mandate owner", "uzoechiraphael1@gmail.com")
  .option("--sub-account <id>", "sub-account identifier", "testnet-demo")
  .action(async (text: string, opts: { owner: string; subAccount: string }) => {
    await mandateCompileCommand(text, opts.owner, opts.subAccount);
  });

program
  .command("approvals")
  .description("List escalated proposals waiting on, or already given, a human decision")
  .option("--status <status>", "pending, granted, rejected, or expired")
  .action(async (opts: { status?: string }) => {
    await approvalsListCommand(opts.status);
  });

program
  .command("approve")
  .description("Approve an escalated proposal. It is re-checked against current conditions, then executed.")
  .argument("<approvalId>")
  .option("--approver <name>", "who is approving (defaults to your OS username)")
  .option("--note <text>", "reason recorded in the audit log")
  .action(async (approvalId: string, opts: { approver?: string; note?: string }) => {
    await approveCommand(approvalId, opts.approver, opts.note);
  });

program
  .command("reject")
  .description("Reject an escalated proposal. Nothing is placed.")
  .argument("<approvalId>")
  .option("--approver <name>", "who is rejecting (defaults to your OS username)")
  .option("--note <text>", "reason recorded in the audit log")
  .action(async (approvalId: string, opts: { approver?: string; note?: string }) => {
    await rejectCommand(approvalId, opts.approver, opts.note);
  });

program
  .command("halt")
  .description("Engage the kill switch: every proposal is vetoed until it is released")
  .option("--by <name>", "who is halting (defaults to your OS username)")
  .option("--reason <text>", "why, recorded in the audit log")
  .option("--cancel-open", "also cancel every CHARTER order resting on the book", false)
  .action(async (opts: { by?: string; reason?: string; cancelOpen: boolean }) => {
    await haltCommand(opts.by, opts.reason, opts.cancelOpen);
  });

program
  .command("orders")
  .description("List CHARTER orders resting on the book")
  .action(async () => {
    await ordersCommand();
  });

program
  .command("cancel")
  .description("Cancel a resting CHARTER order")
  .argument("<symbol>")
  .argument("<orderId>")
  .option("--by <name>", "who is cancelling (defaults to your OS username)")
  .option("--reason <text>")
  .action(async (symbol: string, orderId: string, opts: { by?: string; reason?: string }) => {
    await cancelCommand(symbol, orderId, opts.by, opts.reason);
  });

program
  .command("resume")
  .description("Release the kill switch")
  .option("--by <name>", "who is resuming (defaults to your OS username)")
  .action(async (opts: { by?: string }) => {
    await resumeCommand(opts.by);
  });

program
  .command("status")
  .description("Show whether the kill switch is engaged and how many approvals are pending")
  .action(async () => {
    await controlStatusCommand();
  });

const agent = program.command("agent").description("Register the agents allowed to propose, each with its own key bound to specific mandates");

agent
  .command("add")
  .description("Register an agent and print its key once")
  .argument("<agentId>")
  .requiredOption("--mandate <id...>", "mandate id(s) this agent may propose against")
  .option("--by <name>", "who is registering (defaults to your OS username)")
  .action(async (agentId: string, opts: { mandate: string[]; by?: string }) => {
    await agentAddCommand(agentId, opts.mandate, opts.by);
  });

agent
  .command("rotate")
  .description("Issue a new key for an agent; the old one stops working immediately")
  .argument("<agentId>")
  .option("--by <name>")
  .action(async (agentId: string, opts: { by?: string }) => {
    await agentRotateCommand(agentId, opts.by);
  });

agent
  .command("revoke")
  .description("Revoke an agent's key")
  .argument("<agentId>")
  .option("--by <name>")
  .action(async (agentId: string, opts: { by?: string }) => {
    await agentRevokeCommand(agentId, opts.by);
  });

agent
  .command("list")
  .description("List registered agents")
  .action(async () => {
    await agentListCommand();
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

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  // Not process.exit(): on Windows that can trip a libuv assertion while
  // network handles are still closing. Setting the code lets the process drain.
  process.exitCode = 1;
});
