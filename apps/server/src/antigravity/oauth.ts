import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { LoginOptions, OAuthCredential, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { loadCodeAssist } from "./client.ts";
import type { CallbackServer } from "./types.ts";
import { antigravityEnv, defaultProjectId, escapeHtml, redactSecrets, resolveCallbackHost } from "./util.ts";

const REDIRECT_URI = "http://localhost:51121/oauth-callback";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const SCOPES = [
  "https://www.googleapis.com/auth/aicode",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

const CLIENT_ID =
  antigravityEnv("CLIENT_ID") ||
  atob("MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==");
const CLIENT_SECRET = antigravityEnv("CLIENT_SECRET") || atob("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");

const CALLBACK_HOST = resolveCallbackHost();

function oauthCallbackHeaders(contentType = "text/html; charset=utf-8"): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
  };
}

function sanitizeOAuthProviderError(text: string): string {
  const redacted = redactSecrets(text).trim();
  try {
    const parsed = JSON.parse(redacted) as {
      error?: string;
      error_description?: string;
    };
    const parts = [parsed.error, parsed.error_description].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    if (parts.length) return parts.join(": ").slice(0, 300);
  } catch {
    // not JSON
  }
  return redacted.slice(0, 300) || "unknown OAuth provider error";
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function getUserEmail(token: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { email?: string };
    return data.email;
  } catch {
    return undefined;
  }
}

function closeServerGracefully(server: Server): void {
  if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  server.close();
}

function startCallbackServer(expectedState: string): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resolveCode!: (value: { code: string; state: string }) => void;
    let rejectCode!: (error: Error) => void;
    const codePromise = new Promise<{ code: string; state: string }>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      fn();
    };

    const server = createServer((req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, oauthCallbackHeaders("text/plain; charset=utf-8"));
        res.end("Method Not Allowed");
        return;
      }

      const reqUrl = new URL(req.url || "/", "http://localhost:51121");
      if (reqUrl.pathname !== "/oauth-callback") {
        res.writeHead(404, oauthCallbackHeaders("text/plain; charset=utf-8"));
        res.end("Not Found");
        return;
      }

      const error = reqUrl.searchParams.get("error");
      const code = reqUrl.searchParams.get("code");
      const state = reqUrl.searchParams.get("state");

      if (error) {
        res.writeHead(400, oauthCallbackHeaders());
        res.end(
          `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;">` +
            `<h2>Sign-in failed</h2><p>${escapeHtml(error)}</p></body></html>`,
        );
        finish(() => rejectCode(new Error(`OAuth error: ${error}`)));
        return;
      }

      if (!code || !state) {
        res.writeHead(400, oauthCallbackHeaders());
        res.end(
          `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;">` +
            `<h2>Missing parameters</h2><p>Missing code or state.</p></body></html>`,
        );
        finish(() => rejectCode(new Error("Missing OAuth code or state")));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, oauthCallbackHeaders());
        res.end(
          `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;">` +
            `<h2>State mismatch</h2><p>Invalid OAuth state.</p></body></html>`,
        );
        finish(() => rejectCode(new Error("OAuth state mismatch")));
        return;
      }

      res.writeHead(200, oauthCallbackHeaders());
      res.end(
        `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;">` +
          `<h2>Signed in to Antigravity</h2>` +
          `<p>You can close this tab and return to Tandem.</p>` +
          `<script>window.close();</script></body></html>`,
      );
      finish(() => resolveCode({ code, state }));
    });

    server.once("error", (err) => {
      finish(() => {
        closeServerGracefully(server);
        reject(err);
      });
    });

    server.listen(51121, CALLBACK_HOST, () => {
      timeout = setTimeout(() => {
        finish(() => {
          closeServerGracefully(server);
          rejectCode(new Error("OAuth callback timeout"));
        });
      }, OAUTH_CALLBACK_TIMEOUT_MS);
      if (typeof timeout.unref === "function") timeout.unref();

      resolve({
        server,
        waitForCode: () => codePromise,
        cleanup: () => {
          finish(() => closeServerGracefully(server));
        },
      });
    });
  });
}

function parsePastedCallback(raw: string, expectedState: string): { code: string; state: string } {
  const text = raw.trim();
  let candidate = text;
  if (!candidate.startsWith("http://") && !candidate.startsWith("https://")) {
    candidate = candidate.startsWith("/oauth-callback")
      ? `http://localhost:51121${candidate}`
      : `http://localhost:51121/oauth-callback${candidate.startsWith("?") ? "" : "?"}${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Could not parse URL");
  }

  const error = url.searchParams.get("error");
  if (error) throw new Error(`OAuth error: ${error}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) throw new Error("Callback URL has no 'code' parameter");
  if (!state) throw new Error("Callback URL has no 'state' parameter");
  if (state !== expectedState) throw new Error("OAuth state mismatch");

  return { code, state };
}

async function acquireAuthCode(
  expectedState: string,
  opts: {
    waitForCode: () => Promise<{ code: string; state: string }>;
    interaction: ProviderAuthInteraction;
  },
): Promise<{ code: string; state: string }> {
  const { waitForCode, interaction } = opts;
  const settle = new AbortController();
  const candidates: Promise<{ code: string; state: string }>[] = [waitForCode()];

  if (typeof interaction.prompt === "function") {
    const promptLoop = async (): Promise<{ code: string; state: string }> => {
      let promptMessage =
        "Remote/headless machine? After signing in, paste the callback URL from your browser's address bar:";
      while (true) {
        if (interaction.signal.aborted || settle.signal.aborted) {
          throw new Error("Login cancelled");
        }
        let text: string;
        try {
          text = await interaction.prompt({
            type: "text",
            message: promptMessage,
            placeholder: "http://localhost:51121/oauth-callback?state=…&code=…",
          });
        } catch (err: unknown) {
          throw err instanceof Error ? err : new Error(String(err));
        }
        if (interaction.signal.aborted || settle.signal.aborted) {
          throw new Error("Login cancelled");
        }
        try {
          return parsePastedCallback(text, expectedState);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          promptMessage = `Invalid callback (${errorMessage}). Please paste the full URL:`;
        }
      }
    };
    candidates.push(promptLoop());
  }

  let removeAbortListener: (() => void) | undefined;
  candidates.push(
    new Promise<never>((_resolve, reject) => {
      if (interaction.signal.aborted) return reject(new Error("Login cancelled"));
      const onAbort = () => reject(new Error("Login cancelled"));
      interaction.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => interaction.signal.removeEventListener("abort", onAbort);
    }),
  );

  for (const candidate of candidates) {
    candidate.catch(() => {});
  }

  try {
    return await Promise.race(candidates);
  } finally {
    settle.abort();
    removeAbortListener?.();
  }
}

export async function loginAntigravity(
  interaction: ProviderAuthInteraction,
  _options?: LoginOptions,
): Promise<OAuthCredential> {
  const { verifier, challenge } = generatePKCE();
  const state = base64Url(randomBytes(32));
  let callbackServer: CallbackServer | undefined;
  try {
    callbackServer = await startCallbackServer(state);
  } catch {
    // If port 51121 is unavailable, we still proceed with manual URL pasting.
  }

  try {
    const authParams = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      prompt: "consent",
    });

    const authUrl = `${AUTH_URL}?${authParams.toString()}`;
    interaction.notify({
      type: "auth_url",
      url: authUrl,
      instructions:
        "Complete Google sign-in. Tandem captures the local callback automatically — or, on a remote machine, paste the callback URL when prompted.",
    });

    const waitForCode = callbackServer ? callbackServer.waitForCode : () => new Promise<never>(() => {});
    const { code, state: returnedState } = await acquireAuthCode(state, {
      waitForCode,
      interaction,
    });
    if (returnedState !== state) throw new Error("OAuth state mismatch");

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${sanitizeOAuthProviderError(await tokenResponse.text())}`);
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    if (!tokenData.refresh_token) {
      throw new Error("No refresh token received. Re-run sign-in and allow offline access.");
    }

    const [email, discoveredProject] = await Promise.all([
      getUserEmail(tokenData.access_token),
      loadCodeAssist(tokenData.access_token),
    ]);

    return {
      type: "oauth",
      refresh: tokenData.refresh_token,
      access: tokenData.access_token,
      expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
      projectId: discoveredProject || defaultProjectId(email || "antigravity-default"),
      email,
    };
  } finally {
    callbackServer?.cleanup();
  }
}

export async function refreshAntigravityToken(
  credentials: OAuthCredential,
  _signal?: AbortSignal,
): Promise<OAuthCredential> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: credentials.refresh,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Antigravity token refresh failed: ${sanitizeOAuthProviderError(await response.text())}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  const existingProjectId = (credentials as { projectId?: string }).projectId;
  const discoveredProject = existingProjectId ? undefined : await loadCodeAssist(data.access_token);
  const email = (credentials as { email?: string }).email;

  return {
    ...credentials,
    type: "oauth",
    refresh: data.refresh_token || credentials.refresh,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    projectId: existingProjectId || discoveredProject || defaultProjectId(email || "antigravity-default"),
  };
}

export function getApiKey(credentials: OAuthCredential): string {
  const email = (credentials as { email?: string }).email;
  const projectId =
    (credentials as { projectId?: string }).projectId || defaultProjectId(email || "antigravity-default");
  return JSON.stringify({
    token: credentials.access,
    projectId,
  });
}
