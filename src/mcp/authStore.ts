import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/** Everything the OAuth flow needs to remember between the redirect out and the code coming back. */
export interface StoredAuth {
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
  clientInformation?: OAuthClientInformationMixed;
}

/**
 * Persists OAuth state to one JSON file (gitignored, under data/). Tokens are
 * bearer credentials for the account, so the file is created readable by the
 * owner only. On Windows that mode is advisory; keep the file out of shared
 * folders.
 */
export class AuthStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<StoredAuth> {
    if (!existsSync(this.filePath)) return {};
    try {
      return JSON.parse(await readFile(this.filePath, "utf-8")) as StoredAuth;
    } catch {
      return {};
    }
  }

  async update(patch: Partial<StoredAuth>): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const next = { ...(await this.read()), ...patch };
    await writeFile(this.filePath, JSON.stringify(next, null, 2), { encoding: "utf-8", mode: 0o600 });
  }

  async clear(keys: Array<keyof StoredAuth>): Promise<void> {
    const current = await this.read();
    for (const k of keys) delete current[k];
    const dir = path.dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(current, null, 2), { encoding: "utf-8", mode: 0o600 });
  }
}
