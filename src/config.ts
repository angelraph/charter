import "dotenv/config";
import { z } from "zod";

const ConfigSchema = z.object({
  executionVenue: z.enum(["testnet", "mainnet-mcp"]),
  testnet: z.object({
    apiKey: z.string(),
    apiSecret: z.string(),
    baseUrl: z.string().url(),
  }),
  mcp: z.object({
    url: z.string().url(),
  }),
  openaiApiKey: z.string().optional(),
  openaiModel: z.string(),
  apiPort: z.coerce.number().int().positive(),
  apiKey: z.string().optional(),
  auditLogPath: z.string(),
  mandatesDir: z.string(),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const raw = {
    executionVenue: process.env.EXECUTION_VENUE ?? "testnet",
    testnet: {
      apiKey: process.env.BINANCE_TESTNET_API_KEY ?? "",
      apiSecret: process.env.BINANCE_TESTNET_API_SECRET ?? "",
      baseUrl: process.env.BINANCE_TESTNET_BASE_URL ?? "https://testnet.binance.vision",
    },
    mcp: {
      url: process.env.BINANCE_MCP_URL ?? "https://agent.binance.com/mcp/agentic",
    },
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    apiPort: process.env.CHARTER_API_PORT ?? 4477,
    apiKey: process.env.CHARTER_API_KEY || undefined,
    auditLogPath: process.env.CHARTER_AUDIT_LOG_PATH ?? "./data/audit.log.jsonl",
    mandatesDir: process.env.CHARTER_MANDATES_DIR ?? "./data/mandates",
  };

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Invalid configuration:\n" + parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"));
    process.exit(1);
  }

  // Deliberately no venue-specific validation here (e.g. "testnet needs API keys").
  // config.ts is imported by modules with nothing to do with any venue, such as
  // the audit log and the mandate store, and by the unit tests. A missing
  // credential should fail loudly the moment something actually tries to use
  // that venue, not the moment any file merely imports config. See
  // venues/index.ts for that check.
  return parsed.data;
}

export const config = loadConfig();
