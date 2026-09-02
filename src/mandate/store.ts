import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { MandateSchema, type Mandate } from "./schema.js";

export async function loadMandate(id: string): Promise<Mandate> {
  const filePath = path.join(config.mandatesDir, `${id}.json`);
  const raw = JSON.parse(await readFile(filePath, "utf-8"));
  return MandateSchema.parse(raw);
}

export async function saveMandate(mandate: Mandate): Promise<void> {
  if (!existsSync(config.mandatesDir)) mkdirSync(config.mandatesDir, { recursive: true });
  const filePath = path.join(config.mandatesDir, `${mandate.id}.json`);
  await writeFile(filePath, JSON.stringify(mandate, null, 2), "utf-8");
}
