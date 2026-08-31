/**
 * OAuth Callback Handler for Vercel
 * 
 * Handles the OAuth authorization callback from Swiggy's OAuth server.
 * Stores the authorization code in Redis for the session to pick up.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import { redisOAuthState } from "../src/lib/RedisOAuthState.js";

interface CallbackStore {
  code?: string;
  state?: string;
  error?: string;
}

// In-memory store for pending OAuth callbacks
// Maps state -> {code, state, error}
const pendingCallbacks = new Map<string, CallbackStore>();

export async function handleOAuthCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    // Validate state parameter is present
    if (!state) {
      res.statusCode = 400;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end("<html><body><h1>Missing state parameter</h1></body></html>");
      return;
    }

    if (error) {
      pendingCallbacks.set(state, {
        error: `Authorization error: ${error} ${errorDescription ?? ""}`
      });
      // Store in Redis
      await redisOAuthState.save(state, { state } as any);
      
      res.statusCode = 400;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        "<html><body><h1>Authorization Failed</h1><p>" +
        errorDescription +
        "</p><p>You may close this window and try again.</p></body></html>"
      );
      return;
    }

    if (!code) {
      pendingCallbacks.set(state, {
        error: "Missing authorization code in callback"
      });
      await redisOAuthState.save(state, { state } as any);
      
      res.statusCode = 400;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end("<html><body><h1>Missing Authorization Code</h1><p>You may close this window and try again.</p></body></html>");
      return;
    }

    // Store the code for this session
    pendingCallbacks.set(state, { code, state });

    // Store in Redis as well if available
    await redisOAuthState.save(state, { state, authorizationCode: code } as any);

    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      "<html><body style='font-family: system-ui; text-align: center; padding: 40px;'>" +
      "<h1 style='color: #28a745;'>✓ Authorization Successful</h1>" +
      "<p>Authorization code received.</p>" +
      "<p>You may now close this window and return to the application.</p>" +
      "<script>setTimeout(() => { if (window.opener) { window.close(); } }, 3000);</script>" +
      "</body></html>"
    );
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.statusCode = 500;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end("<html><body><h1>Internal Server Error</h1><p>Failed to process OAuth callback.</p></body></html>");
  }
}

export function registerPendingCallback(state: string): void {
  pendingCallbacks.set(state, {});
}

export function getPendingCode(state: string): string | undefined {
  const data = pendingCallbacks.get(state);
  return data?.code;
}

export function getPendingError(state: string): string | undefined {
  const data = pendingCallbacks.get(state);
  return data?.error;
}

export function clearPendingCallback(state: string): void {
  pendingCallbacks.delete(state);
}

// Export default handler for Vercel
export default handleOAuthCallback;

