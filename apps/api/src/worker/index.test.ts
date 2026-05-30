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

  it("reports Stripe credit purchases disabled until configured", async () => {
    const response = await worker.fetch(request("/api/payments/config"), {} as Env);

    await expect(response.json()).resolves.toEqual({ creditPurchasesEnabled: false });
    expect(response.status).toBe(200);
  });

  it("requires Stripe configuration before creating credit purchases", async () => {
    const response = await worker.fetch(
      new Request("https://api.test/api/payments/credit-purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents: 500 })
      }),
      {} as Env
    );

    await expect(response.json()).resolves.toEqual({
      error: "Credit purchases are temporarily unavailable because Stripe is not fully configured."
    });
    expect(response.status).toBe(403);
  });
});
