import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MandateSchema } from "../../mandate/schema.js";
import { saveMandate } from "../../mandate/store.js";
import { auditLog } from "../../audit/log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Seeds the demo mandate from src/mandate/examples/demo-mandate.json. */
export async function initCommand(): Promise<void> {
  const examplePath = path.join(__dirname, "../../mandate/examples/demo-mandate.json");
  const raw = JSON.parse(await readFile(examplePath, "utf-8"));
  const mandate = MandateSchema.parse(raw);

  await saveMandate(mandate);
  await auditLog.append("MANDATE_CREATED", "n/a", { mandateId: mandate.id, source: "demo-mandate.json", limits: mandate.limits });

  console.log(`Mandate ${mandate.id} activated.`);
  console.log(`  Covenant: "${mandate.naturalLanguageSource}"`);
  console.log(`  Per-trade max: $${mandate.limits.perTradeMaxUsd}`);
  console.log(`  Daily spend cap: $${mandate.limits.dailySpendCapUsd}`);
  console.log(`  Confirm above: $${mandate.limits.confirmAboveUsd}`);
  console.log(`  Allowed symbols: ${mandate.limits.allowedSymbols?.join(", ") ?? "any"}`);
}
