import { mkdirSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { AuthStore } from "../../mcp/authStore.js";
import { AUTH_FILE, connectMcp, NotLoggedInError } from "../../mcp/session.js";
import { probeAuth } from "../../mcp/probe.js";

const TOOLS_FILE = "./data/mcp-tools.json";

export async function mcpProbeCommand(): Promise<void> {
  const p = await probeAuth(config.mcp.url);
  console.log(`Server:                         ${p.serverUrl}`);
  console.log(`Unauthenticated request:        HTTP ${p.status}${p.status === 401 ? " (wants OAuth)" : ""}`);
  console.log(`Authorization server:           ${p.authorizationServers.join(", ") || "not found"}`);
  console.log(`Authorize endpoint:             ${p.authorizationEndpoint ?? "not found"}`);
  console.log(`Token endpoint:                 ${p.tokenEndpoint ?? "not found"}`);
  console.log(`Grant types:                    ${p.grantTypes.join(", ") || "none listed"}`);
  console.log(`PKCE methods:                   ${p.codeChallengeMethods.join(", ") || "none listed"}`);
  console.log(`Client authentication:          ${p.tokenEndpointAuthMethods.join(", ") || "none listed"}`);
  console.log(`Client ID metadata documents:   ${p.supportsClientIdMetadataDocument ? "supported" : "not supported"}`);
  console.log(`Dynamic client registration:    ${p.supportsDynamicRegistration ? "supported" : "not supported"}`);
  console.log(`Refresh tokens:                 ${p.offersRefreshTokens ? "offered" : "not offered"}`);
  for (const n of p.notes) console.log(`\n${n}`);
  console.log(`\nCHARTER identifies itself as: ${config.mcp.clientMetadataUrl}`);
  console.log("That URL has to serve docs/mcp-client.json over HTTPS before the server can accept a login.");
}

export async function mcpLoginCommand(): Promise<void> {
  console.log(`Connecting to ${config.mcp.url} ...`);
  const session = await connectMcp({ interactive: true });
  try {
    const { tools } = await session.client.listTools();
    console.log(`\nLogged in. The server offers ${tools.length} tool${tools.length === 1 ? "" : "s"}. Run \`charter mcp tools\` to see them.`);
  } finally {
    await session.close();
  }
}

export async function mcpToolsCommand(): Promise<void> {
  let session;
  try {
    session = await connectMcp({ interactive: false });
  } catch (err) {
    if (err instanceof NotLoggedInError) throw err;
    throw err;
  }
  try {
    const { tools } = await session.client.listTools();
    for (const t of tools) {
      const props = (t.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined) ?? {};
      const names = Object.keys(props.properties ?? {});
      const required = new Set(props.required ?? []);
      const args = names.map((n) => (required.has(n) ? n : `${n}?`)).join(", ");
      console.log(`${t.name}(${args})`);
      if (t.description) console.log(`    ${t.description.split("\n")[0]}`);
    }
    const dir = path.dirname(TOOLS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await writeFile(TOOLS_FILE, JSON.stringify(tools, null, 2), "utf-8");
    console.log(`\nFull tool definitions, including argument schemas, saved to ${TOOLS_FILE}`);
  } finally {
    await session.close();
  }
}

export async function mcpStatusCommand(): Promise<void> {
  const auth = await new AuthStore(AUTH_FILE).read();
  console.log(`Client ID:         ${config.mcp.clientMetadataUrl}`);
  console.log(`Callback:          http://127.0.0.1:${config.mcp.callbackPort}/callback`);
  console.log(`Stored login:      ${auth.tokens ? "yes" : "none"}`);
  if (auth.tokens) console.log(`Refresh token:     ${auth.tokens.refresh_token ? "yes" : "no (login ends with the access token)"}`);
}
