import { randomBytes } from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthStore } from "./authStore.js";

export interface ProviderOptions {
  store: AuthStore;
  /** HTTPS URL of the client metadata document. It doubles as CHARTER's client_id. */
  clientMetadataUrl: string;
  /** Where the browser is sent back with the authorization code. */
  redirectUrl: string;
  /** Sends the user to Binance's consent page. Injected so it can be a browser launch in the CLI and a spy in tests. */
  openBrowser: (url: URL) => void | Promise<void>;
}

/**
 * OAuth for the Binance Agent OS MCP server. The server advertises a public
 * client (no secret), PKCE, the authorization_code grant only, and no dynamic
 * registration. Instead it accepts a client_id that is an HTTPS URL of a
 * metadata document, which is what `clientMetadataUrl` is.
 *
 * No refresh token is offered by the server, so when the access token
 * expires the person has to consent again.
 */
export class CharterOAuthProvider implements OAuthClientProvider {
  readonly clientMetadataUrl: string;

  constructor(private readonly opts: ProviderOptions) {
    this.clientMetadataUrl = opts.clientMetadataUrl;
  }

  get redirectUrl(): string {
    return this.opts.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "CHARTER",
      client_uri: "https://github.com/angelraph/charter",
      redirect_uris: [this.opts.redirectUrl],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async state(): Promise<string> {
    const state = randomBytes(24).toString("base64url");
    await this.opts.store.update({ state });
    return state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.opts.store.read()).clientInformation;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await this.opts.store.update({ clientInformation: info });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.opts.store.read()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.opts.store.update({ tokens });
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.opts.store.update({ codeVerifier });
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await this.opts.store.read()).codeVerifier;
    if (!verifier) throw new Error("No PKCE code verifier saved. Start the login again with `charter mcp login`.");
    return verifier;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.opts.openBrowser(authorizationUrl);
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all") await this.opts.store.clear(["tokens", "codeVerifier", "state", "clientInformation"]);
    else if (scope === "tokens") await this.opts.store.clear(["tokens"]);
    else if (scope === "client") await this.opts.store.clear(["clientInformation"]);
    else if (scope === "verifier") await this.opts.store.clear(["codeVerifier"]);
  }
}
