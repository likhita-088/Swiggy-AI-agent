import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Agent } from "./src/agent.js";

const PORT = Number(process.env.SWIGGY_DEMO_PORT || 3001);
const PUBLIC_DIR = path.join(process.cwd(), "public");

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function serveStatic(res: ServerResponse, urlPath: string) {
  const filePath = urlPath === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, urlPath);
  try {
    const content = await readFile(filePath);
    const ext = path.extname(filePath);
    const contentType =
      ext === ".html" ? "text/html; charset=utf-8"
      : ext === ".css" ? "text/css; charset=utf-8"
      : ext === ".js" ? "text/javascript; charset=utf-8"
      : "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("content-type", contentType);
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}

export async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // CORS (same-origin by default, but harmless to allow localhost dev)
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const raw = await readBody(req);
      let parsed: { message?: string; sessionId?: string };
      try {
        parsed = JSON.parse(raw || "{}");
      } catch {
        sendJson(res, 400, { error: "Invalid JSON body." });
        return;
      }

      const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
      if (!message) {
        sendJson(res, 400, { error: "Missing 'message'." });
        return;
      }

      const sessionId =
        typeof parsed.sessionId === "string" && parsed.sessionId ? parsed.sessionId : crypto.randomUUID();

      try {
        const reply = await Agent.process(message, sessionId);
        sendJson(res, 200, { reply, sessionId });
      } catch (agentError) {
        // Handle OAuth authorization errors on Vercel
        if (agentError instanceof Error && agentError.message.startsWith("[OAUTH_REQUIRED]")) {
          const authUrl = agentError.message.substring("[OAUTH_REQUIRED]".length);
          sendJson(res, 401, {
            error: "Authorization required",
            requiresAuth: true,
            authorizationUrl: authUrl,
            sessionId
          });
          return;
        }
        throw agentError;
      }
      return;
    }

    if (req.method === "GET") {
      await serveStatic(res, url.pathname);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Server error:", message);
    sendJson(res, 500, { error: message });
  }
}

if (process.env.VERCEL !== "1") {
  const server = createServer(handler);
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Swiggy AI Agent demo running at http://127.0.0.1:${PORT}`);
  });
}
