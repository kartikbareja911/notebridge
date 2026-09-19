import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Logger } from "pino";
import {
  extractBearerToken,
  hashApiKey,
  type ApiKeyAuthenticator,
  type AuthenticatedUser,
} from "../services/auth.js";
import type { RateLimiter } from "./rate-limit.js";

const MCP_PATH = "/mcp";
const DEFAULT_MAX_BODY_BYTES = 2_000_000;

interface ActiveSession {
  userId: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export interface NoteBridgeHttpServerOptions {
  authenticate: ApiKeyAuthenticator;
  createServer: (user: AuthenticatedUser) => McpServer;
  logger: Logger;
  rateLimiter: RateLimiter;
  maxBodyBytes?: number;
}

export interface NoteBridgeHttpServer {
  listen(port: number, host?: string): Promise<AddressInfo>;
  address(): AddressInfo | null;
  close(): Promise<void>;
}

export function createNoteBridgeHttpServer(
  options: NoteBridgeHttpServerOptions,
): NoteBridgeHttpServer {
  const sessions = new Map<string, ActiveSession>();
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  const httpServer = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      options.logger.error(
        { error: error instanceof Error ? error.message : "Unknown HTTP error" },
        "Unhandled HTTP request error",
      );
      sendJson(response, 500, {
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    });
  });

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== MCP_PATH) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        Allow: "GET, POST, DELETE, OPTIONS",
      });
      response.end();
      return;
    }

    const rawToken = extractBearerToken(request.headers.authorization);
    if (!rawToken) {
      sendUnauthorized(response);
      return;
    }

    const rateLimit = options.rateLimiter.consume(hashApiKey(rawToken));
    response.setHeader("X-RateLimit-Limit", String(rateLimit.limit));
    response.setHeader("X-RateLimit-Remaining", String(rateLimit.remaining));
    response.setHeader("X-RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1_000)));

    if (!rateLimit.allowed) {
      response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      sendJson(
        response,
        429,
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Rate limit exceeded. Retry later.",
          },
          id: null,
        },
        { "Retry-After": String(rateLimit.retryAfterSeconds) },
      );
      return;
    }

    let user: AuthenticatedUser | null;
    try {
      user = await options.authenticate.authenticate(rawToken);
    } catch (error: unknown) {
      options.logger.error(
        { error: error instanceof Error ? error.message : "Unknown auth error" },
        "API key authentication failed",
      );
      sendJson(response, 503, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Authentication service unavailable" },
        id: null,
      });
      return;
    }

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    if (request.method === "POST") {
      await handlePost(request, response, user);
      return;
    }

    if (request.method === "GET" || request.method === "DELETE") {
      await handleSessionRequest(request, response, user);
      return;
    }

    sendJson(
      response,
      405,
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      },
      { Allow: "GET, POST, DELETE, OPTIONS" },
    );
  }

  async function handlePost(
    request: IncomingMessage,
    response: ServerResponse,
    user: AuthenticatedUser,
  ): Promise<void> {
    let parsedBody: unknown;
    try {
      parsedBody = await readJsonBody(request, maxBodyBytes);
    } catch (error: unknown) {
      const status = error instanceof HttpRequestError ? error.statusCode : 400;
      sendJson(response, status, {
        jsonrpc: "2.0",
        error: {
          code: -32700,
          message: error instanceof Error ? error.message : "Invalid request body",
        },
        id: null,
      });
      return;
    }

    const sessionId = readSessionId(request);
    if (sessionId) {
      const session = getOwnedSession(sessionId, user.id);
      if (!session) {
        sendSessionNotFound(response);
        return;
      }
      await session.transport.handleRequest(request, response, parsedBody);
      return;
    }

    const session = await createSession(user);
    await session.transport.handleRequest(request, response, parsedBody);

    if (!session.transport.sessionId) {
      await closeSession(session);
    }
  }

  async function handleSessionRequest(
    request: IncomingMessage,
    response: ServerResponse,
    user: AuthenticatedUser,
  ): Promise<void> {
    const sessionId = readSessionId(request);
    if (!sessionId) {
      sendJson(response, 400, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Mcp-Session-Id header is required." },
        id: null,
      });
      return;
    }

    const session = getOwnedSession(sessionId, user.id);
    if (!session) {
      sendSessionNotFound(response);
      return;
    }

    await session.transport.handleRequest(request, response);
    if (request.method === "DELETE") {
      await closeSession(session);
    }
  }

  async function createSession(user: AuthenticatedUser): Promise<ActiveSession> {
    const server = options.createServer(user);
    let activeSession: ActiveSession | null = null;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        if (activeSession) {
          sessions.set(sessionId, activeSession);
        }
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
      },
    });

    const transportAdapter: Transport = {
      start: () => transport.start(),
      send: (message, sendOptions) =>
        sendOptions ? transport.send(message, sendOptions) : transport.send(message),
      close: () => transport.close(),
    };

    transport.onerror = (error) => {
      transportAdapter.onerror?.(error);
      options.logger.error({ error: error.message }, "MCP HTTP transport error");
    };
    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) {
        sessions.delete(sessionId);
      }
      transportAdapter.onclose?.();
    };
    transport.onmessage = (message, extra) =>
      transportAdapter.onmessage?.(message, extra);

    activeSession = { userId: user.id, server, transport };
    await server.connect(transportAdapter);
    return activeSession;
  }

  function getOwnedSession(sessionId: string, userId: string): ActiveSession | null {
    const session = sessions.get(sessionId);
    return session?.userId === userId ? session : null;
  }

  async function closeSession(session: ActiveSession): Promise<void> {
    const sessionId = session.transport.sessionId;
    if (sessionId) {
      sessions.delete(sessionId);
    }
    await session.server.close();
    await session.transport.close();
  }

  return {
    async listen(port: number, host = "127.0.0.1"): Promise<AddressInfo> {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          httpServer.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          httpServer.off("error", onError);
          resolve();
        };

        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        httpServer.listen(port, host);
      });

      const address = httpServer.address();
      if (!address || typeof address === "string") {
        throw new Error("HTTP server did not expose a TCP address");
      }
      return address;
    },

    address(): AddressInfo | null {
      const address = httpServer.address();
      return address && typeof address !== "string" ? address : null;
    },

    async close(): Promise<void> {
      for (const session of [...sessions.values()]) {
        await closeSession(session);
      }
      sessions.clear();

      if (!httpServer.listening) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !contentType.includes("application/json")) {
    throw new HttpRequestError("Content-Type must be application/json.", 415);
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new HttpRequestError("Request body is too large.", 413);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new HttpRequestError("Request body must not be empty.", 400);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpRequestError("Request body contains invalid JSON.", 400);
  }
}

function readSessionId(request: IncomingMessage): string | null {
  const header = request.headers["mcp-session-id"];
  const value = Array.isArray(header) ? header[0] : header;
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  return normalized;
}

function sendUnauthorized(response: ServerResponse): void {
  sendJson(
    response,
    401,
    {
      jsonrpc: "2.0",
      error: { code: -32001, message: "Valid bearer API key required." },
      id: null,
    },
    { "WWW-Authenticate": "Bearer" },
  );
}

function sendSessionNotFound(response: ServerResponse): void {
  sendJson(response, 404, {
    jsonrpc: "2.0",
    error: { code: -32001, message: "MCP session not found." },
    id: null,
  });
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  if (response.headersSent || response.writableEnded) {
    return;
  }

  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(body);
}
