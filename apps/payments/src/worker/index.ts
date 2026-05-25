import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { authAccount, authSession, authUser, authVerification, createDb, eq, ledgerEntries, walletAccounts } from "@moltbooky/db";

const app = new OpenAPIHono<{ Bindings: Env }>();

const errorResponseSchema = z.object({ error: z.string() });
const depositRequestSchema = z.object({
  amountCents: z.number().int().min(500).max(10_000)
});

const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification
};

function createAuth(env: Env) {
  return betterAuth({
    appName: "Moltbooky",
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:5173",
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET ?? "local-dev-secret-change-before-deploy",
    database: drizzleAdapter(createDb(env.DATABASE_URL), {
      provider: "pg",
      schema: authSchema
    }),
    emailAndPassword: {
      enabled: true
    },
    trustedOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"]
  });
}

async function getSessionUserId(env: Env, request: Request): Promise<string | null> {
  const session = await createAuth(env).api.getSession({ headers: request.headers });
  return session?.user?.id ?? null;
}

function jsonError(c: any, message: string, status: 400 | 401 | 403 | 500) {
  return c.json({ error: message }, status) as any;
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

app.doc("/api/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Moltbooky Payments API",
    version: "0.1.0",
    description: "Stripe-backed payment endpoints. Launch remains gated by PAYMENT_LAUNCH_APPROVED."
  }
});

const healthRoute = createRoute({
  method: "get",
  path: "/api/payments/health",
  responses: {
    200: {
      description: "Health check",
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), name: z.string() })
        }
      }
    }
  }
});

app.openapi(healthRoute, (c) => c.json({ ok: true, name: "Moltbooky Payments" }));

const createDepositRoute = createRoute({
  method: "post",
  path: "/api/payments/deposits",
  request: {
    body: {
      content: {
        "application/json": {
          schema: depositRequestSchema
        }
      }
    }
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
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    403: { description: "Payments disabled", content: { "application/json": { schema: errorResponseSchema } } },
    500: { description: "Stripe error", content: { "application/json": { schema: errorResponseSchema } } }
  }
});

app.openapi(createDepositRoute, async (c) => {
  if (c.env.PAYMENT_LAUNCH_APPROVED !== "true") {
    return jsonError(c, "Real-money deposits are disabled until legal and Stripe approval are complete.", 403);
  }
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_SUCCESS_URL || !c.env.STRIPE_CANCEL_URL) {
    return jsonError(c, "Stripe is not configured.", 500);
  }

  const userId = await getSessionUserId(c.env, c.req.raw);
  if (!userId) {
    return jsonError(c, "Sign in before creating a deposit.", 401);
  }

  const { amountCents } = c.req.valid("json");
  const form = new URLSearchParams({
    mode: "payment",
    success_url: c.env.STRIPE_SUCCESS_URL,
    cancel_url: c.env.STRIPE_CANCEL_URL,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][price_data][product_data][name]": "Moltbooky deposit",
    "metadata[userId]": userId,
    "metadata[amountCents]": String(amountCents)
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form
  });

  const stripeSession = (await response.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !stripeSession.id || !stripeSession.url) {
    return jsonError(c, stripeSession.error?.message ?? "Failed to create Stripe Checkout session.", 500);
  }

  return c.json({ checkoutUrl: stripeSession.url, sessionId: stripeSession.id });
});

const webhookRoute = createRoute({
  method: "post",
  path: "/api/payments/stripe/webhook",
  responses: {
    200: {
      description: "Webhook handled",
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean() })
        }
      }
    },
    400: { description: "Invalid webhook", content: { "application/json": { schema: errorResponseSchema } } },
    500: { description: "Webhook processing failed", content: { "application/json": { schema: errorResponseSchema } } }
  }
});

app.openapi(webhookRoute, async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) {
    return jsonError(c, "Stripe webhook signing secret is not configured.", 500);
  }

  const signature = c.req.header("stripe-signature");
  const payload = await c.req.text();
  if (!signature || !(await verifyStripeSignature(payload, signature, c.env.STRIPE_WEBHOOK_SECRET))) {
    return jsonError(c, "Invalid Stripe signature.", 400);
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
    return jsonError(c, "Invalid checkout session metadata.", 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(ledgerEntries)
      .values({
        id: newId("led"),
        userId,
        type: "deposit",
        amountCents,
        idempotencyKey: `stripe:checkout:${session.id}`,
        description: "Stripe deposit"
      })
      .onConflictDoNothing()
      .returning({ id: ledgerEntries.id });

    if (!inserted[0]) {
      return;
    }

    const wallet = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for("update").limit(1);
    if (!wallet[0]) {
      throw new Error("Wallet not found.");
    }

    await tx
      .update(walletAccounts)
      .set({
        availableCents: wallet[0].availableCents + amountCents,
        updatedAt: new Date()
      })
      .where(eq(walletAccounts.userId, userId));
  });

  return c.json({ ok: true });
});

async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const timestamp = header
    .split(",")
    .map((part) => part.split("="))
    .find(([key]) => key === "t")?.[1];
  const signatures = header
    .split(",")
    .map((part) => part.split("="))
    .filter(([key]) => key === "v1")
    .map(([, value]) => value);

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

export default app;
