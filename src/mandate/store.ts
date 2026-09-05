import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { MandateSchema, type Mandate } from "./schema.js";

export class MandateNotFoundError extends Error {
  constructor(public readonly mandateId: string) {
    super(`No mandate found with id ${mandateId}`);
    this.name = "MandateNotFoundError";
  }
}

export async function loadMandate(id: string): Promise<Mandate> {
  const filePath = path.join(config.mandatesDir, `${id}.json`);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MandateNotFoundError(id);
    }
    throw err;
  }
  return MandateSchema.parse(JSON.parse(raw));
}

export async function saveMandate(mandate: Mandate): Promise<void> {
  if (!existsSync(config.mandatesDir)) mkdirSync(config.mandatesDir, { recursive: true });
  const filePath = path.join(config.mandatesDir, `${mandate.id}.json`);
  await writeFile(filePath, JSON.stringify(mandate, null, 2), "utf-8");
}
