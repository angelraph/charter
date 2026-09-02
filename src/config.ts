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
  anthropicApiKey: z.string().optional(),
  apiPort: z.coerce.number().int().positive(),
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
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    apiPort: process.env.CHARTER_API_PORT ?? 4477,
    auditLogPath: process.env.CHARTER_AUDIT_LOG_PATH ?? "./data/audit.log.jsonl",
    mandatesDir: process.env.CHARTER_MANDATES_DIR ?? "./data/mandates",
  };

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Invalid configuration:\n" + parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"));
    process.exit(1);
  }

  if (parsed.data.executionVenue === "testnet" && (!parsed.data.testnet.apiKey || !parsed.data.testnet.apiSecret)) {
    console.error(
      "EXECUTION_VENUE=testnet requires BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_API_SECRET.\n" +
        "Register at https://testnet.binance.vision (GitHub login) to get them, then copy .env.example to .env and fill them in."
    );
    process.exit(1);
  }

  return parsed.data;
}

export const config = loadConfig();
