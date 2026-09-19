import "dotenv/config";
import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://notebridge:notebridge@localhost:5432/notebridge"),
  OPENAI_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  EMBEDDING_PROVIDER: z.enum(["openai", "local"]).default("openai"),
  EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  LOCAL_EMBEDDING_MODEL: z.string().min(1).default("Xenova/bge-small-en-v1.5"),
  NOTEBRIDGE_API_KEY: z.string().min(1).default("local-dev-key"),
  NOTEBRIDGE_USER_ID: z.uuid().default("00000000-0000-4000-8000-000000000001"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  MAX_HTTP_BODY_BYTES: z.coerce.number().int().positive().default(2_000_000),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(env);
}
