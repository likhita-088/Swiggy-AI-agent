import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { registerClient, discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
  OAuthClientMetadata
} from "@modelcontextprotocol/sdk/shared/auth";

const DEFAULT_CALLBACK_PORT = process.env.SWIGGY_MCP_CALLBACK_PORT ? Number(process.env.SWIGGY_MCP_CALLBACK_PORT) : 3000;
const AUTH_STATE_FILE = path.resolve(process.cwd(), ".swiggy-mcp-auth.json");
const AUTH_SCOPE = "mcp:tools";
const AUTH_HOST = "127.0.0.1";
const AUTH_PATH = "/callback";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

interface StoredAuthState {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
}

interface PendingAuthorization {
  promise: Promise<string>;
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

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

function sanitizeUrl(url: URL): string {
  return url.toString();
}

export class SwiggyMcpClient {
  private readonly mcpUrl = new URL("https://mcp.swiggy.com/food");
  private readonly authStateFile = AUTH_STATE_FILE;
  private provider: SwiggyOAuthProvider;
  private client: Client;
  private transport?: StreamableHTTPClientTransport;

  constructor() {
    this.provider = new SwiggyOAuthProvider(
      this.authStateFile,
      DEFAULT_CALLBACK_PORT,
      AUTH_PATH,
      new URL("https://mcp.swiggy.com/")
    );
    this.client = new Client({ name: "swiggy-mcp-client", version: "1.0.0" });
  }

  async connect(): Promise<void> {
    if (!this.transport) {
      this.transport = new StreamableHTTPClientTransport(this.mcpUrl, {
        authProvider: this.provider
      });
    }

    await this.provider.clientInformation();

    try {
      await this.client.connect(this.transport);
      return;
    } catch (error) {
      if (error instanceof Error && error.name === "UnauthorizedError") {
        const authorizationCode = await this.provider.waitForAuthorizationCode();
        await this.transport.finishAuth(authorizationCode);
        await this.client.connect(this.transport);
        return;
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = undefined;
    }
  }

  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    const result = await this.client.listTools();
    return (result.tools ?? []).map((tool: any) => ({ name: tool.name, description: tool.description }));
  }

  // Return full tool definitions as provided by the MCP server.
  async listToolsFull(): Promise<any[]> {
    const result = await this.client.listTools();
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.client.callTool({ name, arguments: args });
    } catch (error) {
      if (error instanceof Error && "message" in error) {
        if (error.message.includes("401") || error.message.includes("Unauthorized")) {
          throw new Error("Unauthorized: authentication required. Please retry after authorizing the application.");
        }
        if (error.message.includes("403")) {
          throw new Error("Forbidden: access denied or insufficient scope.");
        }
        if (error.message.includes("429")) {
          throw new Error("Too Many Requests: rate limited by the MCP server.");
        }
      }
      throw error;
    }
  }
}

class SwiggyOAuthProvider implements OAuthClientProvider {
  private readonly authStateFile: string;
  private readonly callbackPort: number;
  private readonly callbackPath: string;
  private readonly authorizationServerUrl: URL;
  private authState: StoredAuthState = {};
  private pendingAuthorization?: PendingAuthorization;
  private server?: ReturnType<typeof createServer>;
  private serverStarted = false;
  private expectedState?: string;

  constructor(authStateFile: string, callbackPort: number, callbackPath: string, authorizationServerUrl: URL) {
    this.authStateFile = authStateFile;
    this.callbackPort = callbackPort;
    this.callbackPath = callbackPath;
    this.authorizationServerUrl = authorizationServerUrl;
  }

  get redirectUrl(): string {
    return `http://${AUTH_HOST}:${this.callbackPort}${this.callbackPath}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: AUTH_SCOPE,
      client_name: "Swiggy MCP Local Client"
    };
  }

  async state(): Promise<string> {
    const state = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    this.expectedState = state;
    return state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    await this.loadState();
    const clientInfo = this.authState.clientInformation;
    if (clientInfo?.client_id) {
      return clientInfo;
    }

    const authMetadata = await discoverAuthorizationServerMetadata(this.authorizationServerUrl);
    const fullInformation = await registerClient(this.authorizationServerUrl, {
      metadata: authMetadata,
      clientMetadata: this.clientMetadata,
      scope: AUTH_SCOPE
    });

    await this.saveClientInformation(fullInformation);
    await this.loadState();
    return this.authState.clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    this.authState.clientInformation = clientInformation;
    await this.saveState();
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    await this.loadState();
    return this.authState.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.authState.tokens = tokens;
    await this.saveState();
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.pendingAuthorization) {
      throw new Error("Authorization flow already in progress.");
    }

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (!req.url) {
          res.statusCode = 400;
          res.end("Missing request URL");
          return;
        }

        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        if (requestUrl.pathname !== this.callbackPath) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state");
        const error = requestUrl.searchParams.get("error");
        const errorDescription = requestUrl.searchParams.get("error_description");

        if (error) {
          this.pendingAuthorization?.reject(new Error(`Authorization error: ${error} ${errorDescription ?? ""}`));
          res.statusCode = 400;
          res.end("Authorization failed. You may close this window.");
          return;
        }

        if (!code) {
          this.pendingAuthorization?.reject(new Error("Missing authorization code in callback."));
          res.statusCode = 400;
          res.end("Missing authorization code. You may close this window.");
          return;
        }

        if (this.expectedState && state !== this.expectedState) {
          this.pendingAuthorization?.reject(new Error("Authorization state mismatch."));
          res.statusCode = 400;
          res.end("Invalid authorization state. You may close this window.");
          return;
        }

        this.pendingAuthorization?.resolve(code);
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end("<html><body><h1>Authorization received</h1><p>You may now return to the application.</p></body></html>");
      } catch (innerError) {
        this.pendingAuthorization?.reject(innerError instanceof Error ? innerError : new Error(String(innerError)));
        res.statusCode = 500;
        res.end("Internal error receiving authorization callback.");
      }
    });

    const listenPromise = new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(this.callbackPort, AUTH_HOST, () => {
        this.serverStarted = true;
        resolve();
      });
    });

    await listenPromise;
    this.server = server;

    let resolveAuth: (code: string) => void;
    let rejectAuth: (error: Error) => void;
    const codePromise = new Promise<string>((resolve, reject) => {
      resolveAuth = resolve;
      rejectAuth = reject;
    });

    this.pendingAuthorization = {
      promise: codePromise,
      resolve: resolveAuth!,
      reject: rejectAuth!,
      timeout: setTimeout(() => {
        this.pendingAuthorization?.reject(new Error("Authorization timed out."));
      }, AUTH_TIMEOUT_MS)
    };

    const openUrl = sanitizeUrl(authorizationUrl);
    try {
      await openBrowser(openUrl);
    } catch (openError) {
      console.error("Unable to open the browser automatically. Please open this URL manually:", openUrl);
    }

    // Return immediately. The authorization code will be received later via HTTP callback.
    return;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.authState.codeVerifier = codeVerifier;
    await this.saveState();
  }

  async codeVerifier(): Promise<string> {
    await this.loadState();
    return this.authState.codeVerifier ?? "";
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    await this.loadState();
    switch (scope) {
      case "all":
        this.authState.clientInformation = undefined;
        this.authState.tokens = undefined;
        this.authState.codeVerifier = undefined;
        this.authState.discoveryState = undefined;
        break;
      case "client":
        this.authState.clientInformation = undefined;
        break;
      case "tokens":
        this.authState.tokens = undefined;
        break;
      case "verifier":
        this.authState.codeVerifier = undefined;
        break;
      case "discovery":
        this.authState.discoveryState = undefined;
        break;
    }
    await this.saveState();
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.authState.discoveryState = state;
    await this.saveState();
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    await this.loadState();
    return this.authState.discoveryState;
  }

  private async loadState(): Promise<void> {
    try {
      const raw = await readFile(this.authStateFile, "utf8");
      this.authState = JSON.parse(raw) as StoredAuthState;
    } catch {
      this.authState = {};
    }
  }

  private async saveState(): Promise<void> {
    const stateJson = JSON.stringify(this.authState, null, 2);
    await writeFile(this.authStateFile, stateJson, "utf8");
  }

  async waitForAuthorizationCode(): Promise<string> {
    if (!this.pendingAuthorization) {
      throw new Error("Authorization flow has not started.");
    }

    try {
      const code = await this.pendingAuthorization.promise;
      return code;
    } finally {
      clearTimeout(this.pendingAuthorization.timeout);
      this.pendingAuthorization = undefined;
      if (this.serverStarted && this.server) {
        await new Promise<void>((resolve) => this.server?.close(() => resolve()));
        this.serverStarted = false;
        this.server = undefined;
      }
    }
  }
}
