import { describe, expect, it, vi } from "vitest";
import worker from "./index";

vi.mock("@moltbooky/db", () => {
  const challenges = {
    id: "id",
    status: "status",
    expiresAt: "expiresAt"
  };

  return {
    and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
    challengeMatches: {},
    challenges,
    creditAccounts: {},
    createDb: vi.fn(() => ({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [{ id: "ch_1" }, { id: "ch_2" }])
          }))
        }))
      }))
    })),
    eq: vi.fn((field: unknown, value: unknown) => ({ type: "eq", field, value })),
    ledgerEntries: {},
    or: vi.fn((...conditions: unknown[]) => ({ type: "or", conditions })),
    pipedreamConnections: {},
    resolutionRuns: {}
  };
});

describe("resolver worker", () => {
  it("serves the resolver health endpoint", async () => {
    const fetch = worker.fetch as (request: Request, env: Env) => Promise<Response>;
    const response = await fetch(new Request("https://resolver.test/"), {} as Env);

    await expect(response.json()).resolves.toEqual({ ok: true, name: "Moltbooky Resolver" });
    expect(response.status).toBe(200);
  });

  it("requires a token for resolver runs", async () => {
    const fetch = worker.fetch as (request: Request, env: Env) => Promise<Response>;
    const response = await fetch(new Request("https://resolver.test/resolve", { method: "POST" }), {} as Env);

    await expect(response.json()).resolves.toEqual({ error: "Resolver access is not allowed." });
    expect(response.status).toBe(403);
  });

  it("rejects invalid signed resolver payloads", async () => {
    const fetch = worker.fetch as (request: Request, env: Env) => Promise<Response>;
    const response = await fetch(
      new Request("https://resolver.test/resolve", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ challengeId: "ch_1" })
      }),
      { RESOLVER_TEST_TOKEN: "test-token" } as Env
    );

    await expect(response.json()).resolves.toEqual({ error: "Invalid resolver request." });
    expect(response.status).toBe(400);
  });
});
