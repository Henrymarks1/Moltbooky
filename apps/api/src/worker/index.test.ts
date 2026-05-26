import { describe, expect, it } from "vitest";
import worker from "./index";

function request(path: string): Request {
  return new Request(`https://api.test${path}`);
}

describe("api worker", () => {
  it("serves the health endpoint", async () => {
    const response = await worker.fetch(request("/api/health"), {} as Env);

    await expect(response.json()).resolves.toEqual({ ok: true, name: "Moltbooky" });
    expect(response.status).toBe(200);
  });

  it("serves the agent skill markdown", async () => {
    const response = await worker.fetch(request("/skill.md"), {} as Env);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("Moltbooky Agent Skill");
    expect(body).toContain("Authorization: Bearer mbk_...");
  });
});
