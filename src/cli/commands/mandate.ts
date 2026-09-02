import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { compileMandateFromText } from "../../mandate/compiler.js";
import { MandateSchema, type Mandate } from "../../mandate/schema.js";
import { saveMandate } from "../../mandate/store.js";
import { auditLog } from "../../audit/log.js";

/**
 * `charter mandate compile "<covenant text>"` — drafts a policy from
 * plain English, shows it for review, and requires the operator to type
 * the literal word ACTIVATE before it becomes a live mandate. Nothing is
 * ever silently activated from LLM output.
 */
export async function mandateCompileCommand(covenantText: string, owner: string, subAccountId: string): Promise<void> {
  console.log(`\nCompiling covenant:\n  "${covenantText}"\n`);
  console.log("Calling the mandate compiler...");

  const limits = await compileMandateFromText(covenantText);

  const draft: Mandate = {
    id: randomUUID(),
    version: 1,
    owner,
    createdAt: new Date().toISOString(),
    subAccountId,
    naturalLanguageSource: covenantText,
    limits,
    status: "draft",
  };

  console.log("\nDraft mandate (not yet active):");
  console.log(JSON.stringify(draft.limits, null, 2));
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "ACTIVATE" to make this the live policy, or anything else to abort: ');
  rl.close();

  if (answer.trim() !== "ACTIVATE") {
    console.log("Aborted. Mandate was not activated.");
    return;
  }

  const active: Mandate = { ...draft, status: "active" };
  await saveMandate(active);
  await auditLog.append("MANDATE_CREATED", "n/a", { mandateId: active.id, source: "nl-compiler", covenantText, limits: active.limits });

  console.log(`\nMandate ${active.id} is now ACTIVE.`);
  console.log(`Use --mandate ${active.id} on "charter propose" to evaluate proposals against it.`);
}
