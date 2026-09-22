import { describe, expect, it } from "vitest";
import { getToolCatalog } from "../src/tools/definitions.js";

describe("MCP tool catalog", () => {
  it("defines all four core tools with complete JSON schemas", () => {
    const catalog = getToolCatalog();

    expect(catalog.map((tool) => tool.name)).toEqual([
      "search_notes",
      "get_note",
      "create_note",
      "delete_note",
      "list_notes",
      "summarize_topic",
      "ingest_document",
    ]);

    for (const tool of catalog) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema).toMatchObject({
        type: "object",
      });
    }

    const searchSchema = catalog[0].inputSchema as unknown as {
      properties?: Record<string, { description?: string }>;
      required?: string[];
    };
    expect(searchSchema.required).toContain("query");
    expect(searchSchema.properties?.query?.description).toBeTruthy();
    expect(searchSchema.properties?.top_k?.description).toBeTruthy();
  });
});
