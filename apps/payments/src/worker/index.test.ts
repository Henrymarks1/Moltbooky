import { describe, expect, it } from "vitest";
import app from "./index";

const baseEnv = {
  DATABASE_URL: "postgres://user:pass@example.test/db",
  BETTER_AUTH_URL: "http://localhost:5173"
} as Env;

describe("payments worker", () => {
  it("serves the payments health endpoint", async () => {
    const response = await app.request("/api/payments/health", {}, baseEnv);

    await expect(response.json()).resolves.toEqual({ ok: true, name: "Moltbooky Payments" });
    expect(response.status).toBe(200);
  });

  it("reports USDC payments disabled until Coinbase CDP and Base RPC are configured", async () => {
    const response = await app.request("/api/payments/config", {}, baseEnv);

    await expect(response.json()).resolves.toEqual({ creditPurchasesEnabled: false, cashoutsEnabled: false, chain: "base", asset: "USDC" });
    expect(response.status).toBe(200);
  });

  it("requires full USDC configuration before creating onramp sessions", async () => {
    const response = await app.request(
      "/api/payments/onramp-session",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents: 500 })
      },
      baseEnv
    );

    await expect(response.json()).resolves.toEqual({
      error: "USDC deposits are temporarily unavailable because Coinbase Onramp is not fully configured."
    });
    expect(response.status).toBe(403);
  });
});
