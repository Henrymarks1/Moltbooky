import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_POLICY, createApiKeySecret, hashApiKey } from "../src/domain/apiKeys";

describe("agent api keys", () => {
  it("ships with conservative default policy limits", () => {
    expect(DEFAULT_AGENT_POLICY.scopes).toEqual([
      "challenges:read",
      "challenges:create",
      "matches:create",
      "credits:read"
    ]);
    expect(DEFAULT_AGENT_POLICY.maxStakeCents).toBe(2_500);
    expect(DEFAULT_AGENT_POLICY.dailyStakeLimitCents).toBe(10_000);
    expect(DEFAULT_AGENT_POLICY.denyCategories).toContain("illegal");
  });

  it("hashes api key secrets with sha-256", async () => {
    await expect(hashApiKey("mbk_test_secret")).resolves.toBe(
      "c7f6985e463f3e1a9080ec75f64bab4d77761c160a675c9f0e31b39aac12b9fa"
    );
  });

  it("creates prefixed 32-byte hex secrets", () => {
    const getRandomValues = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      const bytes = array as Uint8Array;
      bytes.fill(171);
      return array;
    });

    expect(createApiKeySecret()).toBe(`mbk_${"ab".repeat(32)}`);
    expect(getRandomValues).toHaveBeenCalledWith(expect.any(Uint8Array));

    getRandomValues.mockRestore();
  });
});
