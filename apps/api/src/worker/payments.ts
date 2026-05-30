import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { createDb, ledgerEntries } from "@moltbooky/db";
import { actorFromRequest, ensureBetaUser, newId } from "./db";
import { applyCreditDelta, errorJson, errorResponses } from "./routes.shared";

const createCreditPurchaseRequestSchema = z.object({
  amountCents: z.number().int().min(500).max(10_000)
});

function stripeCreditPurchasesEnabled(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_SUCCESS_URL && env.STRIPE_CANCEL_URL);
}

async function stripeCheckoutSession(env: Env, params: { userId: string; amountCents: number }): Promise<{ id: string; url: string }> {
  if (!stripeCreditPurchasesEnabled(env)) {
    throw new Error("Stripe credit purchases are not configured.");
  }

  const form = new URLSearchParams({
    mode: "payment",
    success_url: env.STRIPE_SUCCESS_URL!,
    cancel_url: env.STRIPE_CANCEL_URL!,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(params.amountCents),
    "line_items[0][price_data][product_data][name]": "Moltbooky platform credits",
    "metadata[userId]": params.userId,
    "metadata[amountCents]": String(params.amountCents)
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form
  });
  const data = (await response.json().catch(() => ({}))) as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !data.id || !data.url) {
    throw new Error(data.error?.message ?? "Failed to create Stripe Checkout session.");
  }
  return { id: data.id, url: data.url };
}

async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = header.split(",").map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || signatures.length === 0) {
    return false;
  }

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

export function registerPaymentsRoutes(app: OpenAPIHono<{ Bindings: Env }>): void {
  const paymentsConfigRoute = createRoute({
    method: "get",
    path: "/api/payments/config",
    responses: {
      200: {
        description: "Stripe credit purchase configuration",
        content: { "application/json": { schema: z.object({ creditPurchasesEnabled: z.boolean() }) } }
      }
    }
  });

  app.openapi(paymentsConfigRoute, (c) =>
    c.json({
      creditPurchasesEnabled: stripeCreditPurchasesEnabled(c.env)
    })
  );

  const createCreditPurchaseRoute = createRoute({
    method: "post",
    path: "/api/payments/credit-purchases",
    request: {
      body: { content: { "application/json": { schema: createCreditPurchaseRequestSchema } } }
    },
    responses: {
      200: {
        description: "Stripe Checkout session created",
        content: {
          "application/json": {
            schema: z.object({
              checkoutUrl: z.string().url(),
              sessionId: z.string()
            })
          }
        }
      },
      ...errorResponses
    }
  });

  app.openapi(createCreditPurchaseRoute, async (c) => {
    if (!stripeCreditPurchasesEnabled(c.env)) {
      return errorJson(c, "Credit purchases are temporarily unavailable because Stripe is not fully configured.", 403);
    }

    let actor: { userId: string; scopes: string[] };
    try {
      actor = await actorFromRequest(c.env, c.req.raw);
    } catch {
      return errorJson(c, "Sign in before buying credits.", 401);
    }

    const { amountCents } = c.req.valid("json");
    const session = await stripeCheckoutSession(c.env, { userId: actor.userId, amountCents });
    return c.json({ checkoutUrl: session.url, sessionId: session.id });
  });

  const stripeWebhookRoute = createRoute({
    method: "post",
    path: "/api/payments/stripe/webhook",
    responses: {
      200: {
        description: "Stripe webhook handled",
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }
      },
      ...errorResponses
    }
  });

  app.openapi(stripeWebhookRoute, async (c) => {
    if (!c.env.STRIPE_WEBHOOK_SECRET) {
      return errorJson(c, "Stripe webhook signing secret is not configured.", 500);
    }

    const signature = c.req.header("stripe-signature");
    const payload = await c.req.text();
    if (!signature || !(await verifyStripeSignature(payload, signature, c.env.STRIPE_WEBHOOK_SECRET))) {
      return errorJson(c, "Invalid Stripe signature.", 400);
    }

    const event = JSON.parse(payload) as {
      type?: string;
      data?: { object?: { id?: string; metadata?: { userId?: string; amountCents?: string } } };
    };
    if (event.type !== "checkout.session.completed") {
      return c.json({ ok: true });
    }

    const session = event.data?.object;
    const userId = session?.metadata?.userId;
    const amountCents = Number(session?.metadata?.amountCents);
    if (!session?.id || !userId || !Number.isInteger(amountCents) || amountCents <= 0) {
      return errorJson(c, "Invalid checkout session metadata.", 400);
    }

    await ensureBetaUser(c.env, userId);
    const db = createDb(c.env.DATABASE_URL);
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(ledgerEntries)
        .values({
          id: newId("led"),
          userId,
          type: "credit_purchase",
          amountCents,
          idempotencyKey: `stripe:checkout:${session.id}`,
          description: "Stripe credit purchase"
        })
        .onConflictDoNothing()
        .returning({ id: ledgerEntries.id });

      if (!inserted[0]) {
        return;
      }

      await applyCreditDelta(tx, userId, amountCents, 0);
    });

    return c.json({ ok: true });
  });
}
