import express, { type Request, type Response } from "express";
import type { Server } from "node:http";
import { z } from "zod";
import { config } from "../config.js";
import { runProposal } from "../policy/runProposal.js";
import { loadMandate } from "../mandate/store.js";
import { auditLog } from "../audit/log.js";
import type { RunProposalResult } from "../policy/runProposal.js";

const ProposeBodySchema = z.object({
  agentId: z.string().min(1),
  mandateId: z.string().uuid(),
  symbol: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  usd: z.number().positive(),
  reason: z.string().optional(),
  execute: z.boolean().optional().default(false),
});

/**
 * The surface other agents (and the rogue-agent demo process) call.
 * This is what makes CHARTER's veto real rather than staged: any process
 * that can reach this port can propose, and gets a genuine verdict back —
 * there is no separate "demo mode" that fakes a rejection.
 */
export function startApiServer(): Server {
  const app = express();
  app.use(express.json());

  // In-memory index of recent results for GET /status/:id. The audit log
  // remains the durable source of truth; this is just a fast lookup cache.
  const recent = new Map<string, RunProposalResult>();

  app.post("/propose", async (req: Request, res: Response) => {
    const parsed = ProposeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid proposal", issues: parsed.error.issues });
      return;
    }
    try {
      const result = await runProposal(parsed.data);
      recent.set(result.proposal.id, result);
      res.status(200).json({
        proposalId: result.proposal.id,
        verdict: result.verdict,
        execution: result.execution ?? null,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/status/:id", (req: Request, res: Response) => {
    const result = recent.get(req.params.id as string);
    if (!result) {
      res.status(404).json({ error: "Unknown proposal id (not seen since this server started)" });
      return;
    }
    res.json({ proposalId: result.proposal.id, verdict: result.verdict, execution: result.execution ?? null });
  });

  app.get("/mandate", async (req: Request, res: Response) => {
    const id = (req.query.id as string) ?? "b2f1e9a0-1a2b-4c3d-8e4f-000000000001";
    try {
      const mandate = await loadMandate(id);
      res.json(mandate);
    } catch {
      res.status(404).json({ error: `No mandate found with id ${id}` });
    }
  });

  app.get("/audit/tail", async (req: Request, res: Response) => {
    const n = parseInt((req.query.n as string) ?? "20", 10);
    res.json(await auditLog.tail(n));
  });

  const server = app.listen(config.apiPort, () => {
    console.log(`CHARTER API listening on http://localhost:${config.apiPort}`);
    console.log(`  POST   /propose`);
    console.log(`  GET    /status/:id`);
    console.log(`  GET    /mandate?id=<mandateId>`);
    console.log(`  GET    /audit/tail?n=20`);
  });

  return server;
}
