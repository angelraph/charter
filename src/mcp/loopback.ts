import { createServer, type Server } from "node:http";

export interface LoopbackHandle {
  /** Resolves with the authorization code once the browser comes back. Rejects on a wrong state, an error from the server, or a timeout. */
  code: Promise<string>;
  close(): void;
}

/**
 * Listens on 127.0.0.1 for the OAuth redirect. Binds to the loopback
 * interface only, so nothing outside this machine can send it a code, and
 * checks the `state` value so a redirect that this login did not start is
 * refused rather than accepted.
 */
export function listenForAuthorizationCode(options: { port: number; expectedState: () => Promise<string | undefined>; timeoutMs?: number }): Promise<LoopbackHandle> {
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;

  return new Promise((resolveHandle, rejectHandle) => {
    let server: Server;
    let settled = false;
    let timer: NodeJS.Timeout;

    const code = new Promise<string>((resolveCode, rejectCode) => {
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
        // Let the response flush before the listener goes away.
        setTimeout(() => server.close(), 50);
      };

      server = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end("Not found");
          return;
        }

        const reply = (status: number, message: string) =>
          res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(message);

        const error = url.searchParams.get("error");
        if (error) {
          reply(400, `Authorization failed: ${error}. You can close this tab.`);
          finish(() => rejectCode(new Error(`Authorization server returned an error: ${error} ${url.searchParams.get("error_description") ?? ""}`.trim())));
          return;
        }

        const expected = await options.expectedState();
        if (!expected || url.searchParams.get("state") !== expected) {
          reply(400, "This redirect does not match a login CHARTER started. Ignored.");
          finish(() => rejectCode(new Error("Redirect had a missing or wrong state value, so it was refused")));
          return;
        }

        const received = url.searchParams.get("code");
        if (!received) {
          reply(400, "No authorization code in the redirect.");
          finish(() => rejectCode(new Error("Redirect carried no authorization code")));
          return;
        }

        reply(200, "CHARTER is connected. You can close this tab and return to the terminal.");
        finish(() => resolveCode(received));
      });

      timer = setTimeout(() => finish(() => rejectCode(new Error(`No authorization came back within ${Math.round(timeoutMs / 1000)}s`))), timeoutMs);
    });

    // Avoid an unhandled rejection if the caller only attaches later.
    code.catch(() => undefined);

    server!.once("error", (err) => rejectHandle(err));
    server!.listen(options.port, "127.0.0.1", () => resolveHandle({ code, close: () => server.close() }));
  });
}
