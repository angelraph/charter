import OpenAI from "openai";
import { MandateLimitsSchema, type MandateLimits } from "./schema.js";
import { config } from "../config.js";

const SYSTEM_PROMPT = `You compile a human's plain-English trading covenant into a strict JSON policy object.
Output ONLY a JSON object (no markdown fences, no commentary) with exactly these fields:
{
  "perTradeMaxUsd": number,      // max USD notional for a single order
  "dailySpendCapUsd": number,    // max total USD notional across all orders in a day
  "maxLeverage": number,         // 1 if spot-only / no leverage mentioned
  "dailyDrawdownHaltPct": number,// halt all trading if NAV drops this many percent in a day
  "confirmAboveUsd": number,     // orders above this USD size require explicit human confirmation
  "allowedSymbols": string[] | null,   // e.g. ["BTCUSDT","ETHUSDT"], or null if unrestricted
  "blockedSymbols": string[] | null,
  "allowedSides": ("BUY"|"SELL")[] | null,
  "maxSlippageBps": number | null
}
Be conservative: if the covenant doesn't mention a limit, pick a sensible strict default rather than an unlimited one
(e.g. confirmAboveUsd defaults to 4x perTradeMaxUsd if unstated; dailyDrawdownHaltPct defaults to 5 if unstated).
Omit optional array fields as null rather than guessing a symbol list that wasn't mentioned.`;

/**
 * Compiles free-text covenant into draft MandateLimits via the OpenAI API.
 * Always re-validated through MandateLimitsSchema before it's ever shown to
 * the operator — a malformed or out-of-range model response fails loudly
 * here rather than silently becoming a live policy.
 */
export async function compileMandateFromText(covenantText: string): Promise<MandateLimits> {
  if (!config.openaiApiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. The NL mandate compiler is unavailable. " +
        "Edit a mandate JSON file directly under data/mandates/ instead (see src/mandate/examples/demo-mandate.json for the shape)."
    );
  }

  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const response = await client.chat.completions.create({
    model: config.openaiModel,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: covenantText },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error("Mandate compiler received no text response from the model");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Mandate compiler returned non-JSON output:\n${text}`);
  }

  // Normalize explicit nulls to undefined for the optional-field schema.
  const normalized = Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, v === null ? undefined : v])
  );

  const result = MandateLimitsSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(
      `Mandate compiler output failed validation. Refusing to activate an unsafe policy:\n` +
        result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n") +
        `\n\nRaw output:\n${text}`
    );
  }

  return result.data;
}
