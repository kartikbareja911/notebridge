import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { apiKeys, users } from "../db/schema.js";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";

export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

export interface ApiKeyAuthenticator {
  authenticate(rawKey: string): Promise<AuthenticatedUser | null>;
}

export function getLocalUser(config: AppConfig): AuthenticatedUser {
  if (config.NOTEBRIDGE_API_KEY.trim().length === 0) {
    throw new Error("NOTEBRIDGE_API_KEY must not be empty");
  }

  return { id: config.NOTEBRIDGE_USER_ID, email: null };
}

export function generateApiKey(): string {
  return `nb_${randomBytes(32).toString("base64url")}`;
}

export function hashApiKey(rawKey: string): string {
  const normalized = rawKey.trim();
  if (normalized.length === 0) {
    throw new Error("API key must not be empty");
  }

  return createHash("sha256")
    .update("notebridge-api-key-v1\0", "utf8")
    .update(normalized, "utf8")
    .digest("hex");
}

export function extractBearerToken(
  authorizationHeader: string | string[] | undefined,
): string | null {
  const header = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;
  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

export class DatabaseApiKeyAuthenticator implements ApiKeyAuthenticator {
  constructor(private readonly database: Database) {}

  async authenticate(rawKey: string): Promise<AuthenticatedUser | null> {
    const [record] = await this.database
      .select({
        apiKeyId: apiKeys.id,
        userId: users.id,
        email: users.email,
      })
      .from(apiKeys)
      .innerJoin(users, eq(apiKeys.userId, users.id))
      .where(eq(apiKeys.keyHash, hashApiKey(rawKey)))
      .limit(1);

    if (!record) {
      return null;
    }

    await this.database
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, record.apiKeyId));

    return {
      id: record.userId,
      email: record.email,
    };
  }
}

export async function ensureUser(
  database: Database,
  userId: string,
  email?: string,
): Promise<void> {
  await database
    .insert(users)
    .values({
      id: userId,
      ...(email ? { email } : {}),
    })
    .onConflictDoNothing();
}
