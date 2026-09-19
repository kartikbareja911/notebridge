import pino, { type Logger } from "pino";
import type { AppConfig } from "./config.js";

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL">): Logger {
  return pino(
    {
      level: config.LOG_LEVEL,
      base: null,
    },
    pino.destination({ dest: 2, sync: false }),
  );
}
