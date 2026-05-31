import { describe, expect, it, vi } from "vitest";
import worker, { enqueueOpenChallenges } from "./index";

vi.mock("@moltbooky/db", () => {
  const challenges = {
    id: "id",
    status: "status",
    expiresAt: "expiresAt"
  };

  return {
    and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
    challenges,
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
    lte: vi.fn((field: unknown, value: unknown) => ({ type: "lte", field, value })),
    or: vi.fn((...conditions: unknown[]) => ({ type: "or", conditions })),
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

  it("requires a token for manual endpoints outside localhost", async () => {
    const fetch = worker.fetch as (request: Request, env: Env) => Promise<Response>;
    const response = await fetch(new Request("https://resolver.test/enqueue", { method: "POST" }), {
      DATABASE_URL: "postgres://user:pass@example.test/db",
      RESOLUTION_QUEUE: { send: vi.fn() }
    } as unknown as Env);

    await expect(response.json()).resolves.toEqual({ error: "Manual resolver access is not allowed." });
    expect(response.status).toBe(403);
  });

  it("allows manual enqueue on localhost", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const fetch = worker.fetch as (request: Request, env: Env) => Promise<Response>;
    const response = await fetch(new Request("http://localhost/enqueue", { method: "POST" }), {
      DATABASE_URL: "postgres://user:pass@example.test/db",
      RESOLUTION_QUEUE: { send }
    } as unknown as Env);

    await expect(response.json()).resolves.toEqual({ ok: true, enqueued: 2 });
    expect(response.status).toBe(200);
  });

  it("enqueues expired open challenges", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const count = await enqueueOpenChallenges({
      DATABASE_URL: "postgres://user:pass@example.test/db",
      RESOLUTION_QUEUE: { send }
    } as unknown as Env);

    expect(count).toBe(2);
    expect(send).toHaveBeenCalledWith({ challengeId: "ch_1" });
    expect(send).toHaveBeenCalledWith({ challengeId: "ch_2" });
  });
});
