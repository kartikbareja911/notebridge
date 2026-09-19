import "dotenv/config";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.js";
import { ensureUser, generateApiKey, hashApiKey } from "../services/auth.js";
import { apiKeys } from "./schema.js";
import { createDatabase } from "./client.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "user-id": { type: "string" },
      email: { type: "string" },
      label: { type: "string" },
      key: { type: "string" },
    },
  });

  const config = loadConfig();
  const userId = values["user-id"] ?? config.NOTEBRIDGE_USER_ID;
  const email = values.email;
  const label = values.label ?? "remote-api-key";
  const rawKey = values.key ?? generateApiKey();
  const { database, close } = createDatabase(config);

  try {
    await ensureUser(database, userId, email);
    await database.insert(apiKeys).values({
      userId,
      keyHash: hashApiKey(rawKey),
      label,
    });

    console.log(
      JSON.stringify(
        {
          userId,
          email: email ?? null,
          label,
          apiKey: rawKey,
        },
        null,
        2,
      ),
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("API key creation failed", error);
  process.exitCode = 1;
});
