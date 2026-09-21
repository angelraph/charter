import express, { type Request, type Response, type NextFunction } from "express";
import type { Server } from "node:http";
import { z } from "zod";
import { config } from "../config.js";
import { runProposal } from "../policy/runProposal.js";
import { loadMandate, MandateNotFoundError } from "../mandate/store.js";
import { auditLog } from "../audit/log.js";
import type { RunProposalResult } from "../policy/runProposal.js";
import {
  ApprovalBlockedError,
  ApprovalNotFoundError,
  ApprovalStateError,
  AuditIntegrityError,
  SelfApprovalError,
  approve,
  engageKillSwitch,
  getApproval,
  getKillSwitch,
  listApprovals,
  reject,
  releaseKillSwitch,
} from "../approval/service.js";
import type { ApprovalStatus } from "../approval/state.js";
import { authenticateAgent, constantTimeEquals, registryInUse } from "../agents/service.js";
import type { AgentRecord } from "../agents/state.js";

const ProposeBodySchema = z.object({
  /** Required when the caller uses the shared key or no key. For a registered agent it is ignored, and must match if given. */
  agentId: z.string().min(1).optional(),
  mandateId: z.string().uuid(),
  symbol: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  usd: z.number().positive(),
  reason: z.string().optional(),
  execute: z.boolean().optional().default(false),
});

const DecisionBodySchema = z.object({ note: z.string().optional() });
const HaltBodySchema = z.object({ reason: z.string().optional() });

/** Routes that decide something (approve, reject, halt, resume) rather than propose it. */
function isApproverRoute(path: string): boolean {
  return path.startsWith("/approvals") || path.startsWith("/control");
}

/**
 * The surface other agents (and the rogue-agent demo process) call.
 *
 * Two separate credentials, on purpose:
 *   - CHARTER_API_KEY (X-Charter-Api-Key) lets a caller propose and read
 *     the outcome of its own proposals.
 *   - CHARTER_APPROVER_KEY (X-Charter-Approver-Key, plus X-Charter-Approver
 *     naming who is deciding) is required to approve, reject, halt, or
 *     resume. An agent holding only the first key can never approve its
 *     own escalation.
 */
export function startApiServer(): Server {
  const app = express();
  app.use(express.json());

  void registryInUse().then((any) => {
    if (config.requireAgentKeys && !any) {
      console.log("Note: CHARTER_REQUIRE_AGENT_KEYS is set but no agents have been registered, so every proposal is refused until one is (charter agent add).");
    } else if (!config.requireAgentKeys && !config.apiKey && !any) {
      console.log("Warning: no CHARTER_API_KEY is set and no agents have been registered. Anyone who can reach this API can submit proposals.");
    }
  });
  if (!config.approverKey) {
    console.log("Note: CHARTER_APPROVER_KEY is not set, so the approve/reject/halt/resume endpoints are disabled. Use the CLI to decide.");
  }

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (isApproverRoute(req.path)) {
      if (!config.approverKey) {
        res.status(403).json({ error: "Approver endpoints are disabled: CHARTER_APPROVER_KEY is not set on this server" });
        return;
      }
      const presentedApprover = req.get("X-Charter-Approver-Key");
      if (!presentedApprover || !constantTimeEquals(presentedApprover, config.approverKey)) {
        res.status(401).json({ error: "Missing or invalid X-Charter-Approver-Key header" });
        return;
      }
      if (!req.get("X-Charter-Approver")) {
        res.status(400).json({ error: "X-Charter-Approver header is required and must name who is deciding" });
        return;
      }
      next();
      return;
    }

    try {
      const presented = req.get("X-Charter-Api-Key");

      // A registered agent's own key identifies it. From here on its identity
      // comes from the key, never from anything the request body claims.
      const agent = await authenticateAgent(presented);
      if (agent) {
        res.locals.agent = agent;
        next();
        return;
      }

      // The single shared key from before per-agent keys existed. Refused
      // outright when CHARTER_REQUIRE_AGENT_KEYS=true.
      if (!config.requireAgentKeys && config.apiKey && presented && constantTimeEquals(presented, config.apiKey)) {
        next();
        return;
      }

      // Nothing configured at all: open, for local development.
      if (!config.requireAgentKeys && !config.apiKey && !(await registryInUse())) {
        next();
        return;
      }

      res.status(401).json({ error: "Missing or invalid X-Charter-Api-Key header" });
    } catch (err) {
      next(err);
    }
  });

  // In-memory index of recent results for GET /status/:id. The audit log
  // remains the durable source of truth; this is just a fast lookup cache.
  const recent = new Map<string, RunProposalResult>();

  const approver = (req: Request): string => req.get("X-Charter-Approver") as string;

  app.post("/propose", async (req: Request, res: Response) => {
    const parsed = ProposeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid proposal", issues: parsed.error.issues });
      return;
    }
    const agent = res.locals.agent as AgentRecord | undefined;
    let agentId = parsed.data.agentId;
    if (agent) {
      if (agentId !== undefined && agentId !== agent.agentId) {
        res.status(403).json({ error: `This key belongs to agent "${agent.agentId}". It cannot propose as "${agentId}".` });
        return;
      }
      if (!agent.mandateIds.includes(parsed.data.mandateId)) {
        res.status(403).json({ error: `Agent "${agent.agentId}" is not bound to mandate ${parsed.data.mandateId}` });
        return;
      }
      agentId = agent.agentId;
    }
    if (!agentId) {
      res.status(400).json({ error: "agentId is required when not using a registered agent key" });
      return;
    }

    try {
      const result = await runProposal({ ...parsed.data, agentId });
      recent.set(result.proposal.id, result);
      res.status(200).json({
        proposalId: result.proposal.id,
        verdict: result.verdict,
        execution: result.execution ?? null,
        approval: result.approval ?? null,
      });
    } catch (err) {
      if (err instanceof MandateNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/status/:id", (req: Request, res: Response) => {
    const result = recent.get(req.params.id as string);
    const agent = res.locals.agent as AgentRecord | undefined;
    // A registered agent only ever sees its own proposals. Someone else's is
    // reported as unknown, so its existence is not revealed either.
    if (!result || (agent && result.proposal.agentId !== agent.agentId)) {
      res.status(404).json({ error: "Unknown proposal id (not seen since this server started)" });
      return;
    }
    res.json({
      proposalId: result.proposal.id,
      verdict: result.verdict,
      execution: result.execution ?? null,
      approval: result.approval ?? null,
    });
  });

  // What an agent polls after an ESCALATE: only the outcome, never the proposal detail.
  app.get("/escalations/:approvalId", async (req: Request, res: Response) => {
    try {
      const record = await getApproval(req.params.approvalId as string);
      const agent = res.locals.agent as AgentRecord | undefined;
      if (agent && record.proposal.agentId !== agent.agentId) {
        throw new ApprovalNotFoundError(record.approvalId);
      }
      res.json({
        approvalId: record.approvalId,
        status: record.status,
        expiresAt: record.expiresAt,
        resolvedAt: record.resolvedAt ?? null,
      });
    } catch (err) {
      if (err instanceof ApprovalNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/approvals", async (req: Request, res: Response) => {
    const status = req.query.status as ApprovalStatus | undefined;
    res.json(await listApprovals(status));
  });

  const decide =
    (action: "approve" | "reject") =>
    async (req: Request, res: Response): Promise<void> => {
      const body = DecisionBodySchema.safeParse(req.body ?? {});
      if (!body.success) {
        res.status(400).json({ error: "Invalid body", issues: body.error.issues });
        return;
      }
      const id = req.params.id as string;
      try {
        if (action === "approve") {
          const outcome = await approve(id, approver(req), body.data.note);
          res.json({ approval: outcome.record, verdict: outcome.verdict, execution: outcome.execution });
        } else {
          res.json({ approval: await reject(id, approver(req), body.data.note) });
        }
      } catch (err) {
        if (err instanceof ApprovalNotFoundError) {
          res.status(404).json({ error: err.message });
        } else if (err instanceof ApprovalStateError) {
          res.status(409).json({ error: err.message, status: err.status });
        } else if (err instanceof SelfApprovalError) {
          res.status(403).json({ error: err.message });
        } else if (err instanceof ApprovalBlockedError) {
          res.status(422).json({ error: err.message, verdict: err.verdict });
        } else if (err instanceof AuditIntegrityError) {
          res.status(500).json({ error: err.message });
        } else {
          res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        }
      }
    };

  app.post("/approvals/:id/approve", decide("approve"));
  app.post("/approvals/:id/reject", decide("reject"));

  app.get("/control", async (_req: Request, res: Response) => {
    res.json({ killSwitch: await getKillSwitch(), pendingApprovals: (await listApprovals("pending")).length });
  });

  app.post("/control/halt", async (req: Request, res: Response) => {
    const body = HaltBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: "Invalid body", issues: body.error.issues });
      return;
    }
    res.json({ killSwitch: await engageKillSwitch(approver(req), body.data.reason) });
  });

  app.post("/control/resume", async (req: Request, res: Response) => {
    res.json({ killSwitch: await releaseKillSwitch(approver(req)) });
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

  // Last resort: never return a stack trace or file paths to a caller.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: "Request body is not valid JSON" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  });

  const server = app.listen(config.apiPort, () => {
    console.log(`CHARTER API listening on http://localhost:${config.apiPort}`);
    console.log(`  POST   /propose                    (agent key)`);
    console.log(`  GET    /status/:id                 (agent key)`);
    console.log(`  GET    /escalations/:approvalId    (agent key)`);
    console.log(`  GET    /approvals                  (approver key)`);
    console.log(`  POST   /approvals/:id/approve      (approver key)`);
    console.log(`  POST   /approvals/:id/reject       (approver key)`);
    console.log(`  GET    /control                    (approver key)`);
    console.log(`  POST   /control/halt | /resume     (approver key)`);
    console.log(`  GET    /mandate?id=<mandateId>`);
    console.log(`  GET    /audit/tail?n=20`);
  });

  return server;
}
