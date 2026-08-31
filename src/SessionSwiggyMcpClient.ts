/**
 * SessionSwiggyMcpClient.ts - Session-aware wrapper around SwiggyMcpClient
 * 
 * Handles OAuth state management across multiple requests in serverless environments.
 * Uses Redis for state persistence on Vercel, filesystem on local.
 */

import { SwiggyMcpClient } from "./SwiggyMcpClient.js";
import { redisOAuthState } from "./lib/RedisOAuthState.js";
import type { StoredAuthState } from "./SwiggyMcpClient.js";

interface SessionAuthState {
  authorizationUrl?: string;
  authorizationCode?: string;
  error?: string;
  tokens?: any;
  clientInformation?: any;
  codeVerifier?: string;
  discoveryState?: any;
  state?: string;
  expiresAt?: number;
}

export class AuthorizationPendingError extends Error {
  constructor(public authorizationUrl: string) {
    super(`Authorization required: ${authorizationUrl}`);
    this.name = "AuthorizationPendingError";
  }
}

export class SessionSwiggyMcpClient {
  private baseClient: SwiggyMcpClient;
  private sessionId: string;
  private sessionState: Map<string, SessionAuthState> = new Map();
  private isVercel = process.env.VERCEL === "1";

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.baseClient = new SwiggyMcpClient();
  }

  /**
   * Get authorization URL that needs to be visited
   */
  getAuthorizationUrl(sessionId: string): string | null {
    const state = this.sessionState.get(sessionId);
    return state?.authorizationUrl ?? null;
  }

  /**
   * Set authorization code after OAuth callback
   */
  async setAuthorizationCode(code: string): Promise<void> {
    const state = this.sessionState.get(this.sessionId) ?? {};
    state.authorizationCode = code;
    this.sessionState.set(this.sessionId, state);

    // Also persist to Redis if in Vercel
    if (this.isVercel) {
      await redisOAuthState.save(this.sessionId, {
        state: this.sessionState.get(this.sessionId) as any
      });
    }
  }

  /**
   * Get stored authorization code
   */
  getAuthorizationCode(): string | undefined {
    return this.sessionState.get(this.sessionId)?.authorizationCode;
  }

  /**
   * Load session state from Redis (Vercel) or memory
   */
  async loadSessionState(): Promise<void> {
    if (this.isVercel) {
      const redisState = await redisOAuthState.load(this.sessionId);
      if (redisState && typeof redisState === "object") {
        this.sessionState.set(this.sessionId, redisState as SessionAuthState);
      }
    }
  }

  /**
   * Connect to MCP and handle OAuth if needed
   */
  async connect(): Promise<void> {
    try {
      await this.baseClient.connect();
    } catch (error) {
      // If in Vercel, we need to handle OAuth differently
      if (this.isVercel && error instanceof Error && error.name === "UnauthorizedError") {
        // For Vercel, we can't do the local server flow
        // Instead, we need to return the auth URL to the user
        throw new Error(
          "OAuth authorization required. " +
          "In production, you would receive an authorization URL to visit."
        );
      }
      throw error;
    }
  }

  /**
   * List tools from MCP
   */
  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    return this.baseClient.listTools();
  }

  /**
   * List full tool definitions
   */
  async listToolsFull(): Promise<any[]> {
    return this.baseClient.listToolsFull();
  }

  /**
   * Call a tool via MCP
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.baseClient.callTool(name, args);
  }

  /**
   * Disconnect from MCP
   */
  async disconnect(): Promise<void> {
    return this.baseClient.disconnect();
  }
}
