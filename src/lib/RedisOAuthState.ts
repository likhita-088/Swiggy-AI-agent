/**
 * RedisOAuthState.ts - OAuth state persistence for Vercel using Upstash Redis
 * 
 * Handles storing and retrieving OAuth state, tokens, and other sensitive data
 * in Redis for serverless environments, with fallback to filesystem for local dev.
 */

import type { StoredAuthState } from "../SwiggyMcpClient";

interface RedisResponse {
  status?: string;
  error?: string;
  result?: string;
}

class RedisOAuthStateManager {
  private isLocal: boolean;
  private useRedis: boolean;
  private redisUrl?: string;
  private redisToken?: string;

  constructor() {
    this.isLocal = process.env.VERCEL !== "1";
    
    // Check if Redis credentials are available
    this.redisUrl = process.env.KV_REST_API_URL;
    this.redisToken = process.env.KV_REST_API_TOKEN;
    this.useRedis = !this.isLocal && !!this.redisUrl && !!this.redisToken;
  }

  private getKey(sessionId: string): string {
    return `oauth:${sessionId}`;
  }

  async load(sessionId: string): Promise<StoredAuthState> {
    if (this.isLocal || !this.useRedis) {
      return {}; // Return empty state for local dev - filesystem will be used instead
    }

    try {
      const key = this.getKey(sessionId);
      const response = await fetch(`${this.redisUrl}/get/${key}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.redisToken}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        console.error("Redis GET failed:", response.statusText);
        return {};
      }

      const data = (await response.json()) as RedisResponse;
      if (data.result) {
        try {
          return JSON.parse(data.result) as StoredAuthState;
        } catch (e) {
          console.error("Failed to parse Redis state:", e);
          return {};
        }
      }
      return {};
    } catch (error) {
      console.error("Error loading OAuth state from Redis:", error);
      return {};
    }
  }

  async save(sessionId: string, state: StoredAuthState): Promise<void> {
    if (this.isLocal || !this.useRedis) {
      return; // Filesystem persistence will be used instead
    }

    try {
      const key = this.getKey(sessionId);
      const value = JSON.stringify(state);
      
      // Use SET with EX (expiration in seconds) - 24 hours
      const response = await fetch(`${this.redisUrl}/set/${key}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.redisToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          value: value,
          ex: 86400 // 24 hours
        })
      });

      if (!response.ok) {
        console.error("Redis SET failed:", response.statusText);
      }
    } catch (error) {
      console.error("Error saving OAuth state to Redis:", error);
    }
  }

  async delete(sessionId: string): Promise<void> {
    if (this.isLocal || !this.useRedis) {
      return;
    }

    try {
      const key = this.getKey(sessionId);
      await fetch(`${this.redisUrl}/del/${key}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.redisToken}`,
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      console.error("Error deleting OAuth state from Redis:", error);
    }
  }

  isUsingRedis(): boolean {
    return this.useRedis;
  }

  isLocalDevelopment(): boolean {
    return this.isLocal;
  }
}

export const redisOAuthState = new RedisOAuthStateManager();
