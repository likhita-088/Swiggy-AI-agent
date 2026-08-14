import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { URL } from "node:url";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import { startAuthorization, discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth";
import { SwiggyMcpClient } from "./SwiggyMcpClient.js";

const AUTH_HOST = "127.0.0.1";
const AUTH_PORT = 3000;
const AUTH_PATH = "/callback";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const AUTH_SCOPE = "mcp:tools";

function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const command = platform === "win32" ? "rundll32.exe" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];

  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function generateState(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

async function createCallbackServer(expectedState: string, onServerStarted: () => void): Promise<{ server: ReturnType<typeof createServer>; authorizationCode: string }> {
  let timeout: NodeJS.Timeout;
  let server: ReturnType<typeof createServer>;

  const callbackPromise = new Promise<{ server: ReturnType<typeof createServer>; authorizationCode: string }>((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("OAuth callback timed out."));
      server.close(() => {});
    }, AUTH_TIMEOUT_MS);

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        if (!req.url) {
          res.statusCode = 400;
          res.end("Missing request URL");
          return;
        }

        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        if (requestUrl.pathname !== AUTH_PATH) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state");
        const error = requestUrl.searchParams.get("error");
        const errorDescription = requestUrl.searchParams.get("error_description");

        if (error) {
          clearTimeout(timeout);
          reject(new Error(`Authorization error: ${error}${errorDescription ? ` - ${errorDescription}` : ""}`));
          res.statusCode = 400;
          res.end("Authorization failed. You may close this window.");
          return;
        }

        if (!code) {
          clearTimeout(timeout);
          reject(new Error("Missing authorization code in callback."));
          res.statusCode = 400;
          res.end("Missing authorization code. You may close this window.");
          return;
        }


        if (!state) {
          clearTimeout(timeout);
          reject(new Error("Authorization state missing."));
          res.statusCode = 400;
          res.end("Invalid authorization state. You may close this window.");
          return;
        }

        if (state !== expectedState) {
          clearTimeout(timeout);
          reject(new Error("Authorization state mismatch."));
          res.statusCode = 400;
          res.end("Invalid authorization state. You may close this window.");
          return;
        }
        clearTimeout(timeout);
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end("<html><body><h1>Authorization received</h1><p>You may now return to the application.</p></body></html>");
        resolve({ server, authorizationCode: code });
      } catch (error) {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    server.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    server.listen(AUTH_PORT, AUTH_HOST, () => {
      onServerStarted();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.on("listening", () => resolve());
    server.on("error", (error) => reject(error));
  });

  return callbackPromise;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function main() {
  const client = new SwiggyMcpClient();
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.swiggy.com/food"), {
    authProvider: client["provider"]
  });

  let callbackServer: ReturnType<typeof createServer> | undefined;
  let callbackServerStarted = false;
  let expectedStateExists = false;
  let callbackStateReceived = false;
  let stateMatched = false;
  let callbackReceived = false;
  let oauthCompleted = false;
  let mcpConnected = false;
  let toolsDiscovered = 0;
  let oauthUrlHasClientId = false;
  let oauthUrlHasRedirectUri = false;
  let oauthUrlHasState = false;
  try {
    const provider = client["provider"] as any;
    const clientInformation = await provider.clientInformation();
    const redirectUrl = provider.redirectUrl;
    const state = generateState();
    expectedStateExists = !!state;

    if (!clientInformation?.client_id) {
      throw new Error("Missing client_id before authorization.");
    }
    if (!redirectUrl) {
      throw new Error("Missing redirect URL before authorization.");
    }

    const authMetadata = await discoverAuthorizationServerMetadata(new URL("https://mcp.swiggy.com/"));
    const { authorizationUrl, codeVerifier } = await startAuthorization("https://mcp.swiggy.com/", {
      metadata: authMetadata,
      clientInformation,
      redirectUrl: new URL(redirectUrl),
      scope: AUTH_SCOPE,
      state
    });

    if (!provider.saveCodeVerifier) {
      throw new Error("OAuth provider does not support saving PKCE code verifier.");
    }
    await provider.saveCodeVerifier(codeVerifier);

    const params = authorizationUrl.searchParams;
    oauthUrlHasClientId = params.has("client_id");
    oauthUrlHasRedirectUri = params.has("redirect_uri");
    oauthUrlHasState = params.has("state");
    const hasCodeChallenge = params.has("code_challenge");
    const codeChallengeMethod = params.get("code_challenge_method");

    if (!oauthUrlHasClientId || !oauthUrlHasRedirectUri || !oauthUrlHasState || !hasCodeChallenge || codeChallengeMethod !== "S256") {
      throw new Error("Authorization URL is missing required OAuth parameters.");
    }

    const callbackPromise = createCallbackServer(state, () => {
      callbackServerStarted = true;
    });

    const parsed = new URL(authorizationUrl.toString());
    console.log(JSON.stringify({
      hasClientId: parsed.searchParams.has("client_id"),
      hasRedirectUri: parsed.searchParams.has("redirect_uri"),
      hasState: parsed.searchParams.has("state"),
      hasCodeChallenge: parsed.searchParams.has("code_challenge"),
      codeChallengeMethod: parsed.searchParams.get("code_challenge_method"),
      parameterNames: [...parsed.searchParams.keys()]
    }, null, 2));
    console.log("Authorization URL parameter check passed");

    await openBrowser(authorizationUrl.toString());

    const callbackResult = await callbackPromise;
    callbackServer = callbackResult.server;
    callbackReceived = true;
    stateMatched = true;

    await transport.finishAuth(callbackResult.authorizationCode);
    await client["client"].connect(transport);
    mcpConnected = true;
    const tools = await client.listTools();
    toolsDiscovered = tools.length;
    oauthCompleted = true;

    console.log(JSON.stringify({
      callbackServerStarted,
      oauthUrlHasClientId,
      oauthUrlHasRedirectUri,
      oauthUrlHasState,
      callbackReceived,
      stateMatched,
      oauthCompleted,
      mcpConnected,
      toolsDiscovered
    }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      callbackServerStarted,
      oauthUrlHasClientId,
      oauthUrlHasRedirectUri,
      oauthUrlHasState,
      callbackReceived,
      stateMatched,
      oauthCompleted,
      mcpConnected,
      toolsDiscovered,
      error: message
    }, null, 2));
    process.exitCode = 1;
  } finally {
    if (callbackServer) {
      await closeServer(callbackServer);
    }
    await client.disconnect();
  }
}

main();
