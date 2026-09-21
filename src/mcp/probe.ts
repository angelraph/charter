/**
 * Reads what the MCP server publicly says about how to authenticate to it.
 * Everything here is an unauthenticated GET or the 401 to an unauthenticated
 * POST, the same requests any MCP client makes on its first connection. No
 * credential is involved and nothing is bypassed.
 */

export interface AuthProbe {
  serverUrl: string;
  /** HTTP status of an unauthenticated initialize request. 401 means the server wants OAuth. */
  status: number;
  resourceMetadataUrl?: string;
  authorizationServers: string[];
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  grantTypes: string[];
  codeChallengeMethods: string[];
  tokenEndpointAuthMethods: string[];
  supportsClientIdMetadataDocument: boolean;
  supportsDynamicRegistration: boolean;
  offersRefreshTokens: boolean;
  notes: string[];
}

type Fetch = typeof fetch;

export async function probeAuth(serverUrl: string, fetchImpl: Fetch = fetch): Promise<AuthProbe> {
  const result: AuthProbe = {
    serverUrl,
    status: 0,
    authorizationServers: [],
    grantTypes: [],
    codeChallengeMethods: [],
    tokenEndpointAuthMethods: [],
    supportsClientIdMetadataDocument: false,
    supportsDynamicRegistration: false,
    offersRefreshTokens: false,
    notes: [],
  };

  const init = await fetchImpl(serverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "charter-probe", version: "0.1.0" } },
    }),
  });
  result.status = init.status;

  if (init.status !== 401) {
    result.notes.push(init.status === 200 ? "The server accepted an unauthenticated request. It does not require OAuth." : `Unexpected status ${init.status} from an unauthenticated request.`);
    return result;
  }

  const challenge = init.headers.get("www-authenticate") ?? "";
  const match = /resource_metadata="([^"]+)"/.exec(challenge);
  if (!match) {
    result.notes.push("The 401 did not say where to find the OAuth metadata (no resource_metadata in WWW-Authenticate).");
    return result;
  }
  result.resourceMetadataUrl = match[1];

  const resource = await fetchImpl(match[1]!);
  if (!resource.ok) {
    result.notes.push(`Could not read the resource metadata at ${match[1]} (HTTP ${resource.status}).`);
    return result;
  }
  const resourceJson = (await resource.json()) as { authorization_servers?: string[] };
  result.authorizationServers = resourceJson.authorization_servers ?? [];

  const issuer = result.authorizationServers[0];
  if (!issuer) {
    result.notes.push("The resource metadata named no authorization server.");
    return result;
  }

  const asRes = await fetchImpl(`${issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`);
  if (!asRes.ok) {
    result.notes.push(`Could not read the authorization server metadata for ${issuer} (HTTP ${asRes.status}).`);
    return result;
  }
  const as = (await asRes.json()) as {
    authorization_endpoint?: string;
    token_endpoint?: string;
    registration_endpoint?: string;
    grant_types_supported?: string[];
    code_challenge_methods_supported?: string[];
    token_endpoint_auth_methods_supported?: string[];
    client_id_metadata_document_supported?: boolean;
  };

  result.authorizationEndpoint = as.authorization_endpoint;
  result.tokenEndpoint = as.token_endpoint;
  result.grantTypes = as.grant_types_supported ?? [];
  result.codeChallengeMethods = as.code_challenge_methods_supported ?? [];
  result.tokenEndpointAuthMethods = as.token_endpoint_auth_methods_supported ?? [];
  result.supportsClientIdMetadataDocument = as.client_id_metadata_document_supported === true;
  result.supportsDynamicRegistration = Boolean(as.registration_endpoint);
  result.offersRefreshTokens = result.grantTypes.includes("refresh_token");

  if (!result.offersRefreshTokens) result.notes.push("No refresh_token grant is offered, so a login lasts only as long as its access token and then needs a person to approve again.");
  if (!result.supportsDynamicRegistration && result.supportsClientIdMetadataDocument) {
    result.notes.push("There is no dynamic registration. A client identifies itself with an HTTPS URL that hosts its metadata document.");
  }
  return result;
}
