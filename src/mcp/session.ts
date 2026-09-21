import open from "open";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { config } from "../config.js";
import { AuthStore } from "./authStore.js";
import { CharterOAuthProvider } from "./provider.js";
import { listenForAuthorizationCode, type LoopbackHandle } from "./loopback.js";

export const AUTH_FILE = "./data/mcp-auth.json";

export interface McpSession {
  client: Client;
  close(): Promise<void>;
}

export class NotLoggedInError extends Error {
  constructor() {
    super("Not logged in to the Binance MCP server. Run `charter mcp login` first.");
    this.name = "NotLoggedInError";
  }
}

export interface ConnectOptions {
  /** True to send the person to a browser to approve if there is no valid login. False fails with NotLoggedInError instead. */
  interactive: boolean;
  serverUrl?: string;
  clientMetadataUrl?: string;
  callbackPort?: number;
  authFile?: string;
  openBrowser?: (url: URL) => void | Promise<void>;
}

export async function connectMcp(options: ConnectOptions): Promise<McpSession> {
  const serverUrl = new URL(options.serverUrl ?? config.mcp.url);
  const port = options.callbackPort ?? config.mcp.callbackPort;
  const store = new AuthStore(options.authFile ?? AUTH_FILE);

  const provider = new CharterOAuthProvider({
    store,
    clientMetadataUrl: options.clientMetadataUrl ?? config.mcp.clientMetadataUrl,
    redirectUrl: `http://127.0.0.1:${port}/callback`,
    openBrowser:
      options.openBrowser ??
      (async (url) => {
        console.log("\nApprove the connection in your browser. If it does not open, open this address yourself:\n");
        console.log(`  ${url.toString()}\n`);
        await open(url.toString());
      }),
  });

  const attempt = () => {
    const transport = new StreamableHTTPClientTransport(serverUrl, { authProvider: provider });
    const client = new Client({ name: "charter", version: "0.1.0" });
    return { client, transport };
  };

  // The redirect to the browser happens inside connect(), so the local
  // listener has to be up before it, not after the failure.
  let loopback: LoopbackHandle | undefined;
  if (options.interactive) {
    loopback = await listenForAuthorizationCode({ port, expectedState: async () => (await store.read()).state });
  }

  let { client, transport } = attempt();
  try {
    await client.connect(transport);
    loopback?.close();
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      loopback?.close();
      throw err;
    }
    if (!loopback) throw new NotLoggedInError();

    const code = await loopback.code;
    await transport.finishAuth(code);
    ({ client, transport } = attempt());
    await client.connect(transport);
  }

  return { client, close: () => client.close() };
}
