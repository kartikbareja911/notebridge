import { describe, expect, it } from "vitest";
import { extractBearerToken, generateApiKey, hashApiKey } from "../src/services/auth.js";

describe("API key authentication helpers", () => {
  it("hashes keys deterministically without storing the raw key", () => {
    const rawKey = "nb_test_key";
    const hash = hashApiKey(rawKey);

    expect(hash).toBe(hashApiKey(rawKey));
    expect(hash).not.toContain(rawKey);
    expect(hash).toHaveLength(64);
  });

  it("generates high-entropy prefixed keys", () => {
    const first = generateApiKey();
    const second = generateApiKey();

    expect(first).toMatch(/^nb_[A-Za-z0-9_-]{40,}$/);
    expect(first).not.toBe(second);
  });

  it("extracts a case-insensitive bearer token", () => {
    expect(extractBearerToken("bearer nb_demo")).toBe("nb_demo");
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });
});
