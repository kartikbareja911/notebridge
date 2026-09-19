import { toolCalls } from "../db/schema.js";
import type { Database } from "../db/client.js";

export interface ToolCallRecord {
  userId: string;
  toolName: string;
  input: Record<string, unknown>;
  latencyMs: number;
  success: boolean;
}

export interface ToolCallRecorder {
  record(call: ToolCallRecord): Promise<void>;
}

export class DrizzleToolCallRecorder implements ToolCallRecorder {
  constructor(private readonly database: Database) {}

  async record(call: ToolCallRecord): Promise<void> {
    await this.database.insert(toolCalls).values({
      userId: call.userId,
      toolName: call.toolName,
      input: call.input,
      latencyMs: call.latencyMs,
      success: call.success,
    });
  }
}
