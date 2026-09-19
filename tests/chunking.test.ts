import { describe, expect, it } from "vitest";
import { chunkText, estimateTokens } from "../src/services/chunking.js";

describe("chunkText", () => {
  it("returns no chunks for empty content", () => {
    expect(chunkText("  \n  ")).toEqual([]);
  });

  it("keeps short notes in one chunk", () => {
    expect(chunkText("A short note about project planning.")).toEqual([
      "A short note about project planning.",
    ]);
  });

  it("splits long notes without exceeding the token budget", () => {
    const content = Array.from(
      { length: 40 },
      (_, index) => `Paragraph ${index + 1}. ${"Details ".repeat(20)}`,
    ).join("\n\n");

    const chunks = chunkText(content, 50);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => estimateTokens(chunk) <= 50)).toBe(true);
    expect(chunks.join(" ")).toContain("Paragraph 40.");
  });
});
