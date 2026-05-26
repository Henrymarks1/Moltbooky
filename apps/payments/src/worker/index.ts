import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, authAccount, authSession, authUser, authVerification, createDb, eq, gte, ledgerEntries, users, walletAccounts } from "@moltbooky/db";

const app = new OpenAPIHono<{ Bindings: Env }>();

const errorResponseSchema = z.object({ error: z.string() });
const creditPurchaseRequestSchema = z.object({
  amountCents: z.number().int().min(500).max(10_000)
});
const withdrawalRequestSchema = z.object({
  amountCents: z.number().int().min(1)
});

const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification
};

function isLocalAuthUrl(url: string | undefined): boolean {
  return !url || url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1");
}

function resolveAuthSecret(env: Env): string {
  if (env.BETTER_AUTH_SECRET) {
    return env.BETTER_AUTH_SECRET;
  }

  if (isLocalAuthUrl(env.BETTER_AUTH_URL)) {
    return "local-dev-secret-change-before-deploy";
  }

  throw new Error("BETTER_AUTH_SECRET is required outside local development.");
}

function resolveTrustedOrigins(env: Env): string[] {
  const origins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://moltbooky.com",
    "https://www.moltbooky.com"
  ]);

  if (env.BETTER_AUTH_URL) {
    origins.add(new URL(env.BETTER_AUTH_URL).origin);
  }

  return [...origins];
}

function createAuth(env: Env) {
  return betterAuth({
    appName: "Moltbooky",
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:5173",
    basePath: "/api/auth",
    secret: resolveAuthSecret(env),
    database: drizzleAdapter(createDb(env.DATABASE_URL), {
      provider: "pg",
      schema: authSchema
    }),
    emailAndPassword: {
      enabled: true
    },
    trustedOrigins: resolveTrustedOrigins(env)
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

function cashoutsEnabled(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_CONNECT_RETURN_URL && env.STRIPE_CONNECT_REFRESH_URL);
}

async function stripeRequest(
  env: Env,
  path: string,
  options: { body?: URLSearchParams; idempotencyKey?: string; stripeAccount?: string } = {}
): Promise<any> {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe is not configured.");
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
  };
  if (options.body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  if (options.idempotencyKey) {
    headers["idempotency-key"] = options.idempotencyKey;
  }
  if (options.stripeAccount) {
    headers["stripe-account"] = options.stripeAccount;
  }

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: options.body ? "POST" : "GET",
    headers,
    body: options.body
  });
  const data = (await response.json()) as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(data.error?.message ?? "Stripe request failed.");
  }
  return data;
}

async function ensurePaymentsUser(env: Env, userId: string): Promise<{ email: string; name: string; stripeConnectAccountId: string | null; stripeConnectPayoutsEnabled: boolean }> {
  const db = createDb(env.DATABASE_URL);
  const existing = await db
    .select({
      email: users.email,
      name: users.displayName,
      stripeConnectAccountId: users.stripeConnectAccountId,
      stripeConnectPayoutsEnabled: users.stripeConnectPayoutsEnabled
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (existing[0]) {
    return existing[0];
  }

  const authRecord = await db
    .select({
      name: authUser.name,
      email: authUser.email
    })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1);

  const email = authRecord[0]?.email ?? `${userId}@moltbooky.local`;
  const name = authRecord[0]?.name?.trim() || userId;
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({
        id: userId,
        email,
        displayName: name,
        betaStatus: "invited"
      })
      .onConflictDoNothing();
    await tx.insert(walletAccounts).values({ userId }).onConflictDoNothing();
  });

  return { email, name, stripeConnectAccountId: null, stripeConnectPayoutsEnabled: false };
}

async function syncConnectAccount(env: Env, userId: string, accountId: string): Promise<{ payoutsEnabled: boolean; detailsSubmitted: boolean }> {
  const account = await stripeRequest(env, `/accounts/${accountId}`) as { payouts_enabled?: boolean; details_submitted?: boolean };
  const payoutsEnabled = Boolean(account.payouts_enabled);
  await createDb(env.DATABASE_URL)
    .update(users)
    .set({
      stripeConnectPayoutsEnabled: payoutsEnabled,
      kycStatus: payoutsEnabled ? "verified" : "pending"
    })
    .where(eq(users.id, userId));
  return { payoutsEnabled, detailsSubmitted: Boolean(account.details_submitted) };
}

app.doc("/api/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Moltbooky Payments API",
    version: "0.1.0",
    description: "Stripe-backed platform credit purchase endpoints."
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

function creditPurchasesEnabled(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_SUCCESS_URL && env.STRIPE_CANCEL_URL && env.STRIPE_WEBHOOK_SECRET);
}

const configRoute = createRoute({
  method: "get",
  path: "/api/payments/config",
  responses: {
    200: {
      description: "Public payments configuration",
      content: {
        "application/json": {
          schema: z.object({
            creditPurchasesEnabled: z.boolean(),
            cashoutsEnabled: z.boolean()
          })
        }
      }
    }
  }
});

app.openapi(configRoute, (c) => c.json({ creditPurchasesEnabled: creditPurchasesEnabled(c.env), cashoutsEnabled: cashoutsEnabled(c.env) }));

const creditPurchaseResponses = {
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
} as const;

async function createCreditPurchase(c: any) {
  if (!creditPurchasesEnabled(c.env)) {
    return jsonError(c, "Credit purchases are temporarily unavailable because Stripe is not fully configured.", 403);
  }

  const userId = await getSessionUserId(c.env, c.req.raw);
  if (!userId) {
    return jsonError(c, "Sign in before buying credits.", 401);
  }

  const { amountCents } = c.req.valid("json");
  const form = new URLSearchParams({
    mode: "payment",
    success_url: c.env.STRIPE_SUCCESS_URL,
    cancel_url: c.env.STRIPE_CANCEL_URL,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][price_data][product_data][name]": "Moltbooky platform credits",
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
}

const createCreditPurchaseRoute = createRoute({
  method: "post",
  path: "/api/payments/credit-purchases",
  request: {
    body: {
      content: {
        "application/json": {
          schema: creditPurchaseRequestSchema
        }
      }
    }
  },
  responses: creditPurchaseResponses
});

app.openapi(createCreditPurchaseRoute, createCreditPurchase);

const createDepositRoute = createRoute({
  method: "post",
  path: "/api/payments/deposits",
  request: {
    body: {
      content: {
        "application/json": {
          schema: creditPurchaseRequestSchema
        }
      }
    }
  },
  responses: creditPurchaseResponses
});

app.openapi(createDepositRoute, createCreditPurchase);

const connectStatusRoute = createRoute({
  method: "get",
  path: "/api/payments/connect/status",
  responses: {
    200: {
      description: "Stripe Connect payout onboarding status",
      content: {
        "application/json": {
          schema: z.object({
            cashoutsEnabled: z.boolean(),
            connected: z.boolean(),
            payoutsEnabled: z.boolean(),
            onboardingRequired: z.boolean()
          })
        }
      }
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    500: { description: "Stripe error", content: { "application/json": { schema: errorResponseSchema } } }
  }
});

app.openapi(connectStatusRoute, async (c) => {
  const enabled = cashoutsEnabled(c.env);
  const userId = await getSessionUserId(c.env, c.req.raw);
  if (!userId) {
    return jsonError(c, "Sign in before managing bank account setup.", 401);
  }

  const user = await ensurePaymentsUser(c.env, userId);
  if (!enabled || !user.stripeConnectAccountId) {
    return c.json({ cashoutsEnabled: enabled, connected: false, payoutsEnabled: false, onboardingRequired: true });
  }

  const status = await syncConnectAccount(c.env, userId, user.stripeConnectAccountId);
  return c.json({
    cashoutsEnabled: enabled,
    connected: true,
    payoutsEnabled: status.payoutsEnabled,
    onboardingRequired: !status.payoutsEnabled
  });
});

const connectAccountLinkRoute = createRoute({
  method: "post",
  path: "/api/payments/connect/account-link",
  responses: {
    200: {
      description: "Stripe Connect onboarding link",
      content: {
        "application/json": {
          schema: z.object({
            onboardingUrl: z.string().url(),
            accountId: z.string()
          })
        }
      }
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    403: { description: "Cashouts disabled", content: { "application/json": { schema: errorResponseSchema } } },
    500: { description: "Stripe error", content: { "application/json": { schema: errorResponseSchema } } }
  }
});

app.openapi(connectAccountLinkRoute, async (c) => {
  if (!cashoutsEnabled(c.env)) {
    return jsonError(c, "Cashouts are temporarily unavailable because Stripe Connect is not fully configured.", 403);
  }

  const userId = await getSessionUserId(c.env, c.req.raw);
  if (!userId) {
    return jsonError(c, "Sign in before setting up payouts.", 401);
  }

  const user = await ensurePaymentsUser(c.env, userId);
  let accountId = user.stripeConnectAccountId;
  if (!accountId) {
    const form = new URLSearchParams({
      type: "express",
      country: "US",
      email: user.email,
      "capabilities[transfers][requested]": "true",
      "business_profile[url]": c.env.BETTER_AUTH_URL ?? "https://moltbooky.com",
      "metadata[userId]": userId
    });
    const account = await stripeRequest(c.env, "/accounts", { body: form, idempotencyKey: `connect-account:${userId}` }) as { id: string };
    accountId = account.id;
    await createDb(c.env.DATABASE_URL)
      .update(users)
      .set({
        stripeConnectAccountId: accountId,
        stripeConnectPayoutsEnabled: false,
        kycStatus: "pending"
      })
      .where(eq(users.id, userId));
  }

  const linkForm = new URLSearchParams({
    account: accountId,
    refresh_url: c.env.STRIPE_CONNECT_REFRESH_URL!,
    return_url: c.env.STRIPE_CONNECT_RETURN_URL!,
    type: "account_onboarding"
  });
  const accountLink = await stripeRequest(c.env, "/account_links", { body: linkForm }) as { url: string };

  return c.json({ onboardingUrl: accountLink.url, accountId });
});

const withdrawalResponses = {
  201: {
    description: "Stripe transfer and payout created",
    content: {
      "application/json": {
        schema: z.object({
          wallet: z.object({
            userId: z.string(),
            availableCents: z.number().int(),
            lockedCents: z.number().int(),
            pendingWithdrawalCents: z.number().int()
          }),
          transferId: z.string(),
          payoutId: z.string()
        })
      }
    }
  },
  401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
  403: { description: "Cashouts disabled or onboarding incomplete", content: { "application/json": { schema: errorResponseSchema } } },
  500: { description: "Stripe error", content: { "application/json": { schema: errorResponseSchema } } }
} as const;

const withdrawalRoute = createRoute({
  method: "post",
  path: "/api/payments/withdrawals",
  request: {
    body: {
      content: {
        "application/json": {
          schema: withdrawalRequestSchema
        }
      }
    }
  },
  responses: withdrawalResponses
});

app.openapi(withdrawalRoute, async (c) => {
  if (!cashoutsEnabled(c.env)) {
    return jsonError(c, "Cashouts are temporarily unavailable because Stripe Connect is not fully configured.", 403);
  }

  const userId = await getSessionUserId(c.env, c.req.raw);
  if (!userId) {
    return jsonError(c, "Sign in before cashing out.", 401);
  }

  const user = await ensurePaymentsUser(c.env, userId);
  if (!user.stripeConnectAccountId) {
    return jsonError(c, "Connect a bank account before cashing out.", 403);
  }

  const connectStatus = await syncConnectAccount(c.env, userId, user.stripeConnectAccountId);
  if (!connectStatus.payoutsEnabled) {
    return jsonError(c, "Complete bank account setup before cashing out.", 403);
  }

  const { amountCents } = c.req.valid("json");
  const ledgerId = newId("led");
  const db = createDb(c.env.DATABASE_URL);
  let walletResponse: {
    userId: string;
    availableCents: number;
    lockedCents: number;
    pendingWithdrawalCents: number;
  } | null = null;

  await db.transaction(async (tx) => {
    const wallet = await tx
      .select()
      .from(walletAccounts)
      .where(and(eq(walletAccounts.userId, userId), gte(walletAccounts.availableCents, amountCents)))
      .for("update")
      .limit(1);

    if (!wallet[0]) {
      throw new Error("Not enough available credits to cash out.");
    }

    const updated = await tx
      .update(walletAccounts)
      .set({
        availableCents: wallet[0].availableCents - amountCents,
        pendingWithdrawalCents: wallet[0].pendingWithdrawalCents + amountCents,
        updatedAt: new Date()
      })
      .where(eq(walletAccounts.userId, userId))
      .returning({
        userId: walletAccounts.userId,
        availableCents: walletAccounts.availableCents,
        lockedCents: walletAccounts.lockedCents,
        pendingWithdrawalCents: walletAccounts.pendingWithdrawalCents
      });
    walletResponse = updated[0];

    await tx.insert(ledgerEntries).values({
      id: ledgerId,
      userId,
      type: "withdrawal",
      amountCents,
      idempotencyKey: `stripe-connect-withdrawal:${ledgerId}`,
      description: "Stripe cashout requested"
    });
  });

  if (!walletResponse) {
    throw new Error("Credit account could not be updated.");
  }

  let transferId: string | null = null;
  try {
    const transfer = await stripeRequest(c.env, "/transfers", {
      idempotencyKey: `transfer:${ledgerId}`,
      body: new URLSearchParams({
        amount: String(amountCents),
        currency: "usd",
        destination: user.stripeConnectAccountId,
        "metadata[userId]": userId,
        "metadata[ledgerId]": ledgerId
      })
    }) as { id: string };
    transferId = transfer.id;

    const payout = await stripeRequest(c.env, "/payouts", {
      stripeAccount: user.stripeConnectAccountId,
      idempotencyKey: `payout:${ledgerId}`,
      body: new URLSearchParams({
        amount: String(amountCents),
        currency: "usd",
        "metadata[userId]": userId,
        "metadata[ledgerId]": ledgerId,
        "metadata[transferId]": transferId
      })
    }) as { id: string };

    return c.json({ wallet: walletResponse, transferId, payoutId: payout.id }, 201);
  } catch (error) {
    let canRestoreCredits = !transferId;
    if (transferId) {
      await stripeRequest(c.env, `/transfers/${transferId}/reversals`, {
        idempotencyKey: `transfer-reversal:${ledgerId}`,
        body: new URLSearchParams({
          amount: String(amountCents),
          "metadata[userId]": userId,
          "metadata[ledgerId]": ledgerId
        })
      });
      canRestoreCredits = true;
    }

    if (!canRestoreCredits) {
      throw error;
    }

    await db.transaction(async (tx) => {
      const wallet = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for("update").limit(1);
      if (wallet[0]) {
        await tx
          .update(walletAccounts)
          .set({
            availableCents: wallet[0].availableCents + amountCents,
            pendingWithdrawalCents: Math.max(0, wallet[0].pendingWithdrawalCents - amountCents),
            updatedAt: new Date()
          })
          .where(eq(walletAccounts.userId, userId));
      }
    });
    throw error;
  }
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

  if (event.type === "payout.paid" || event.type === "payout.failed") {
    const payout = event.data?.object as {
      id?: string;
      amount?: number;
      metadata?: { userId?: string; ledgerId?: string };
    } | undefined;
    const userId = payout?.metadata?.userId;
    const amountCents = Number(payout?.amount);
    if (!payout?.id || !userId || !Number.isInteger(amountCents) || amountCents <= 0) {
      return jsonError(c, "Invalid payout metadata.", 400);
    }

    const db = createDb(c.env.DATABASE_URL);
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(ledgerEntries)
        .values({
          id: newId("led"),
          userId,
          type: event.type === "payout.paid" ? "withdrawal" : "unlock",
          amountCents,
          idempotencyKey: `stripe:payout:${event.type}:${payout.id}`,
          description: event.type === "payout.paid" ? "Stripe cashout paid" : "Stripe cashout failed"
        })
        .onConflictDoNothing()
        .returning({ id: ledgerEntries.id });

      if (!inserted[0]) {
        return;
      }

      const wallet = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for("update").limit(1);
      if (!wallet[0]) {
        throw new Error("Credit account not found.");
      }

      await tx
        .update(walletAccounts)
        .set({
          availableCents: event.type === "payout.failed" ? wallet[0].availableCents + amountCents : wallet[0].availableCents,
          pendingWithdrawalCents: Math.max(0, wallet[0].pendingWithdrawalCents - amountCents),
          updatedAt: new Date()
        })
        .where(eq(walletAccounts.userId, userId));
    });

    return c.json({ ok: true });
  }

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

    const wallet = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for("update").limit(1);
    if (!wallet[0]) {
      throw new Error("Credit account not found.");
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
