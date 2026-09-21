import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { AuthStore } from "../src/mcp/authStore.js";
import { CharterOAuthProvider } from "../src/mcp/provider.js";
import { listenForAuthorizationCode } from "../src/mcp/loopback.js";
import { probeAuth } from "../src/mcp/probe.js";

const CLIENT_ID_URL = "https://example.test/mcp-client.json";

function tempStore(): AuthStore {
  return new AuthStore(path.join(mkdtempSync(path.join(tmpdir(), "charter-mcp-")), "auth.json"));
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe("AuthStore", () => {
  it("round-trips, merges updates, and clears selected keys", async () => {
    const store = tempStore();
    expect(await store.read()).toEqual({});
    await store.update({ state: "s1" });
    await store.update({ codeVerifier: "v1" });
    expect(await store.read()).toEqual({ state: "s1", codeVerifier: "v1" });
    await store.clear(["state"]);
    expect(await store.read()).toEqual({ codeVerifier: "v1" });
  });

  it("treats a corrupt file as empty", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "charter-mcp-"));
    const file = path.join(dir, "auth.json");
    const store = new AuthStore(file);
    await store.update({ state: "x" });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, "{not json");
    expect(await store.read()).toEqual({});
  });
});

describe("listenForAuthorizationCode", () => {
  it("resolves with the code when the state matches", async () => {
    const port = await freePort();
    const handle = await listenForAuthorizationCode({ port, expectedState: async () => "good" });
    const res = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=good`);
    expect(res.status).toBe(200);
    await expect(handle.code).resolves.toBe("abc");
  });

  it("refuses a redirect with the wrong state", async () => {
    const port = await freePort();
    const handle = await listenForAuthorizationCode({ port, expectedState: async () => "good" });
    const res = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=evil`);
    expect(res.status).toBe(400);
    await expect(handle.code).rejects.toThrow(/state/);
  });

  it("refuses a redirect with no state when one is expected", async () => {
    const port = await freePort();
    const handle = await listenForAuthorizationCode({ port, expectedState: async () => "good" });
    await fetch(`http://127.0.0.1:${port}/callback?code=abc`);
    await expect(handle.code).rejects.toThrow(/state/);
  });

  it("rejects when the server returns an error", async () => {
    const port = await freePort();
    const handle = await listenForAuthorizationCode({ port, expectedState: async () => "good" });
    await fetch(`http://127.0.0.1:${port}/callback?error=access_denied&error_description=nope`);
    await expect(handle.code).rejects.toThrow(/access_denied/);
  });

  it("times out when nothing comes back", async () => {
    const port = await freePort();
    const handle = await listenForAuthorizationCode({ port, expectedState: async () => "good", timeoutMs: 50 });
    await expect(handle.code).rejects.toThrow(/No authorization/);
  });

  it("ignores other paths", async () => {
    const port = await freePort();
    const handle = await listenForAuthorizationCode({ port, expectedState: async () => "good" });
    const res = await fetch(`http://127.0.0.1:${port}/other`);
    expect(res.status).toBe(404);
    handle.close();
  });
});

describe("client metadata document", () => {
  const doc = JSON.parse(readFileSync(path.join(__dirname, "..", "docs", "mcp-client.json"), "utf-8"));

  it("is a public authorization_code client with a loopback redirect", () => {
    expect(doc.token_endpoint_auth_method).toBe("none");
    expect(doc.grant_types).toEqual(["authorization_code"]);
    expect(doc.response_types).toEqual(["code"]);
    for (const uri of doc.redirect_uris as string[]) expect(new URL(uri).hostname).toBe("127.0.0.1");
  });

  it("uses its own hosted URL as the client_id, and that URL is https", () => {
    expect(doc.client_id.startsWith("https://")).toBe(true);
  });
});

describe("OAuth against a fake authorization server", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  interface Seen {
    clientId?: string;
    challenge?: string;
    verifier?: string;
    redirectUri?: string;
  }

  async function startFake(seen: Seen): Promise<string> {
    server = createServer(async (req, res) => {
      const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
      const url = new URL(req.url ?? "/", base);
      const json = (body: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));

      if (url.pathname === "/.well-known/oauth-protected-resource") return json({ resource: `${base}/mcp`, authorization_servers: [base] });
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return json({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          client_id_metadata_document_supported: true,
        });
      }
      if (url.pathname === "/token" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const form = new URLSearchParams(body);
        seen.verifier = form.get("code_verifier") ?? undefined;
        const ok = createHash("sha256").update(seen.verifier ?? "").digest("base64url") === seen.challenge && form.get("client_id") === seen.clientId;
        if (!ok) return res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }));
        return json({ access_token: "tok", token_type: "Bearer", expires_in: 3600 });
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("identifies by metadata URL, sends a PKCE challenge, and exchanges the code with the matching verifier", async () => {
    const seen: Seen = {};
    const base = await startFake(seen);
    const store = tempStore();
    let authorizeUrl: URL | undefined;
    const provider = new CharterOAuthProvider({
      store,
      clientMetadataUrl: CLIENT_ID_URL,
      redirectUrl: "http://127.0.0.1:8976/callback",
      openBrowser: (u) => {
        authorizeUrl = u;
      },
    });

    const first = await auth(provider, { serverUrl: `${base}/mcp` });
    expect(first).toBe("REDIRECT");
    expect(authorizeUrl).toBeDefined();

    const q = authorizeUrl!.searchParams;
    expect(q.get("client_id")).toBe(CLIENT_ID_URL);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:8976/callback");
    expect(q.get("state")).toBe((await store.read()).state);

    seen.clientId = CLIENT_ID_URL;
    seen.challenge = q.get("code_challenge") ?? undefined;

    const second = await auth(provider, { serverUrl: `${base}/mcp`, authorizationCode: "the-code" });
    expect(second).toBe("AUTHORIZED");
    expect(seen.verifier).toBe((await store.read()).codeVerifier);
    expect((await store.read()).tokens?.access_token).toBe("tok");
  });

  it("probeAuth reports what the server advertises", async () => {
    const seen: Seen = {};
    const base = await startFake(seen);
    const stub = ((input: string | URL | Request, init?: RequestInit) => {
      const u = String(input);
      if (init?.method === "POST" && u.endsWith("/mcp")) {
        return Promise.resolve(new Response("", { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` } }));
      }
      return fetch(input as string, init);
    }) as typeof fetch;

    const p = await probeAuth(`${base}/mcp`, stub);
    expect(p.status).toBe(401);
    expect(p.supportsClientIdMetadataDocument).toBe(true);
    expect(p.supportsDynamicRegistration).toBe(false);
    expect(p.offersRefreshTokens).toBe(false);
    expect(p.codeChallengeMethods).toEqual(["S256"]);
    expect(p.tokenEndpoint).toBe(`${base}/token`);
  });

  it("probeAuth notes when no authentication is required", async () => {
    const stub = (() => Promise.resolve(new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    const p = await probeAuth("http://127.0.0.1:1/mcp", stub);
    expect(p.status).toBe(200);
    expect(p.notes[0]).toMatch(/does not require OAuth/);
  });
});
