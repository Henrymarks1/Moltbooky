import { CdpClient } from "@coinbase/cdp-sdk";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  and,
  appUsers,
  authAccount,
  authSession,
  authUser,
  authVerification,
  createDb,
  cryptoTransactions,
  eq,
  gte,
  ledgerEntries,
  userPaymentProfiles,
  walletAccounts
} from "@moltbooky/db";

const app = new OpenAPIHono<{ Bindings: Env }>();

const chain = "base" as const;
const asset = "USDC" as const;
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const errorResponseSchema = z.object({ error: z.string() });
const onrampSessionRequestSchema = z.object({
  amountCents: z.number().int().min(500).max(10_000).optional()
});
const walletSetupRequestSchema = z.object({
  privyUserId: z.string().trim().min(1).optional(),
  withdrawalAddress: z.string().trim().min(1).optional()
});
const withdrawalRequestSchema = z.object({
  amountCents: z.number().int().min(1),
  withdrawalAddress: z.string().trim().min(1).optional()
});

const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification
};

type PaymentProfile = {
  userId: string;
  privyUserId: string | null;
  withdrawalAddress: string | null;
  depositWalletId: string | null;
  depositAddress: string | null;
  chain: string;
  lastScannedBlock: number | null;
};

type RpcLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

app.onError((error, c) => {
  console.error(error);
  return jsonError(c, errorMessage(error, "Payments request failed."), 500);
});

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function isHexAddress(value: string | null | undefined): value is `0x${string}` {
  return Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value));
}

function normalizeAddress(value: string): `0x${string}` {
  if (!isHexAddress(value)) {
    throw new Error("Enter a valid EVM wallet address.");
  }
  return value.toLowerCase() as `0x${string}`;
}

function addressTopic(address: string): string {
  return `0x${"0".repeat(24)}${normalizeAddress(address).slice(2)}`;
}

function centsToMicroUsdc(amountCents: number): bigint {
  return BigInt(amountCents) * 10_000n;
}

function microUsdcToCents(amountMicroUsdc: bigint): number {
  return Number(amountMicroUsdc / 10_000n);
}

function hexToNumber(hex: string): number {
  return Number.parseInt(hex, 16);
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

function baseUsdcAddress(env: Env): string {
  return normalizeAddress(env.USDC_BASE_CONTRACT_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
}

function minConfirmations(env: Env): number {
  const parsed = Number(env.PAYMENTS_MIN_CONFIRMATIONS ?? "3");
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 3;
}

function paymentsConfigured(env: Env): boolean {
  return Boolean(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET && env.CDP_WALLET_SECRET && env.COINBASE_ONRAMP_PROJECT_ID && env.BASE_RPC_URL);
}

function cashoutsConfigured(env: Env): boolean {
  return Boolean(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET && env.CDP_WALLET_SECRET);
}

function createCdp(env: Env): CdpClient {
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET || !env.CDP_WALLET_SECRET) {
    throw new Error("Coinbase CDP is not configured.");
  }
  return new CdpClient({
    apiKeyId: env.CDP_API_KEY_ID,
    apiKeySecret: env.CDP_API_KEY_SECRET,
    walletSecret: env.CDP_WALLET_SECRET
  });
}

async function cdpApiRequest<T>(env: Env, requestMethod: "GET" | "POST", requestPath: string, body?: unknown): Promise<T> {
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
    throw new Error("Coinbase CDP is not configured.");
  }

  const requestHost = "api.cdp.coinbase.com";
  const token = await generateJwt({
    apiKeyId: env.CDP_API_KEY_ID,
    apiKeySecret: env.CDP_API_KEY_SECRET,
    requestMethod,
    requestHost,
    requestPath
  });

  const response = await fetch(`https://${requestHost}${requestPath}`, {
    method: requestMethod,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string }; message?: string };
  if (!response.ok) {
    throw new Error(data.error?.message ?? data.message ?? "Coinbase CDP request failed.");
  }
  return data;
}

async function ensurePaymentsUser(env: Env, userId: string): Promise<{ email: string; name: string }> {
  const db = createDb(env.DATABASE_URL);
  const existing = await db
    .select({
      email: appUsers.email,
      name: appUsers.displayName
    })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
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
      .insert(appUsers)
      .values({
        id: userId,
        email,
        displayName: name,
        betaStatus: "invited"
      })
      .onConflictDoNothing();
    await tx.insert(walletAccounts).values({ userId }).onConflictDoNothing();
  });

  return { email, name };
}

async function getProfile(env: Env, userId: string): Promise<PaymentProfile | null> {
  const rows = await createDb(env.DATABASE_URL).select().from(userPaymentProfiles).where(eq(userPaymentProfiles.userId, userId)).limit(1);
  return rows[0] ?? null;
}

async function ensurePaymentProfile(env: Env, userId: string, input: { privyUserId?: string; withdrawalAddress?: string } = {}): Promise<PaymentProfile> {
  await ensurePaymentsUser(env, userId);
  const existing = await getProfile(env, userId);
  let depositAddress = existing?.depositAddress ?? null;
  let depositWalletId = existing?.depositWalletId ?? null;

  if (!depositAddress) {
    if (!cashoutsConfigured(env)) {
      throw new Error("Coinbase CDP is not configured.");
    }
    const cdp = createCdp(env);
    const account = await cdp.evm.getOrCreateAccount({ name: `moltbooky-deposit-${userId}` });
    depositAddress = account.address;
    depositWalletId = account.address;
  }

  const withdrawalAddress = input.withdrawalAddress ? normalizeAddress(input.withdrawalAddress) : existing?.withdrawalAddress ?? null;
  const privyUserId = input.privyUserId ?? existing?.privyUserId ?? null;

  const db = createDb(env.DATABASE_URL);
  await db
    .insert(userPaymentProfiles)
    .values({
      userId,
      privyUserId,
      withdrawalAddress,
      depositWalletId,
      depositAddress,
      chain,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: userPaymentProfiles.userId,
      set: {
        privyUserId,
        withdrawalAddress,
        depositWalletId,
        depositAddress,
        chain,
        updatedAt: new Date()
      }
    });

  const profile = await getProfile(env, userId);
  if (!profile) {
    throw new Error("Payment profile could not be created.");
  }
  return profile;
}

async function rpc<T>(env: Env, method: string, params: unknown[]): Promise<T> {
  if (!env.BASE_RPC_URL) {
    throw new Error("Base RPC is not configured.");
  }

  const response = await fetch(env.BASE_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params })
  });
  const data = (await response.json()) as { result?: T; error?: { message?: string } };
  if (!response.ok || data.error || data.result === undefined) {
    throw new Error(data.error?.message ?? "Base RPC request failed.");
  }
  return data.result;
}

async function latestConfirmedBlock(env: Env): Promise<number> {
  const latest = hexToNumber(await rpc<string>(env, "eth_blockNumber", []));
  return Math.max(0, latest - minConfirmations(env));
}

async function scanDepositLogs(env: Env, profile: PaymentProfile): Promise<{ logs: RpcLog[]; scannedToBlock: number }> {
  if (!profile.depositAddress) {
    throw new Error("Set up a deposit wallet before syncing deposits.");
  }

  const scannedToBlock = await latestConfirmedBlock(env);
  const defaultStart = Math.max(0, scannedToBlock - Number(env.PAYMENTS_INITIAL_SCAN_BLOCKS ?? "20000"));
  const configuredStart = env.PAYMENTS_SCAN_START_BLOCK ? Number(env.PAYMENTS_SCAN_START_BLOCK) : defaultStart;
  const fromBlock = Math.max(0, (profile.lastScannedBlock ?? configuredStart - 1) + 1);
  if (fromBlock > scannedToBlock) {
    return { logs: [], scannedToBlock };
  }

  const logs = await rpc<RpcLog[]>(env, "eth_getLogs", [
    {
      address: baseUsdcAddress(env),
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${scannedToBlock.toString(16)}`,
      topics: [transferTopic, null, addressTopic(profile.depositAddress)]
    }
  ]);
  return { logs, scannedToBlock };
}

async function creditDepositLogs(env: Env, profile: PaymentProfile, logs: RpcLog[], scannedToBlock: number): Promise<{ creditedCents: number; deposits: number }> {
  const db = createDb(env.DATABASE_URL);
  let creditedCents = 0;
  let deposits = 0;

  await db.transaction(async (tx) => {
    for (const log of logs) {
      const amountMicroUsdc = hexToBigInt(log.data);
      const amountCents = microUsdcToCents(amountMicroUsdc);
      const txHash = log.transactionHash.toLowerCase();
      const logIndex = hexToNumber(log.logIndex);
      const inserted = await tx
        .insert(cryptoTransactions)
        .values({
          id: newId("ctx"),
          direction: "deposit",
          userId: profile.userId,
          txHash,
          logIndex,
          amountMicroUsdc: amountMicroUsdc.toString(),
          amountCents,
          status: "confirmed",
          providerRef: "base-usdc-transfer",
          blockNumber: hexToNumber(log.blockNumber)
        })
        .onConflictDoNothing()
        .returning({ id: cryptoTransactions.id });

      if (!inserted[0]) {
        continue;
      }

      deposits += 1;
      if (amountCents <= 0) {
        continue;
      }

      const wallet = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, profile.userId)).for("update").limit(1);
      if (!wallet[0]) {
        throw new Error("Credit account not found.");
      }

      await tx
        .update(walletAccounts)
        .set({
          availableCents: wallet[0].availableCents + amountCents,
          updatedAt: new Date()
        })
        .where(eq(walletAccounts.userId, profile.userId));

      await tx.insert(ledgerEntries).values({
        id: newId("led"),
        userId: profile.userId,
        type: "credit_purchase",
        amountCents,
        idempotencyKey: `base-usdc-deposit:${txHash}:${logIndex}`,
        description: "Base USDC deposit"
      });
      creditedCents += amountCents;
    }

    await tx
      .update(userPaymentProfiles)
      .set({ lastScannedBlock: scannedToBlock, updatedAt: new Date() })
      .where(eq(userPaymentProfiles.userId, profile.userId));
  });

  return { creditedCents, deposits };
}

async function getWithdrawalAccount(env: Env, profile: PaymentProfile) {
  const cdp = createCdp(env);
  if (env.CDP_TREASURY_ACCOUNT_NAME) {
    return cdp.evm.getOrCreateAccount({ name: env.CDP_TREASURY_ACCOUNT_NAME });
  }
  if (!profile.depositAddress) {
    throw new Error("Set up a deposit wallet before cashing out.");
  }
  return cdp.evm.getAccount({ address: profile.depositAddress as `0x${string}` });
}

app.doc("/api/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Moltbooky Payments API",
    version: "0.2.0",
    description: "Base USDC platform credit funding and cashout endpoints."
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
            cashoutsEnabled: z.boolean(),
            chain: z.literal(chain),
            asset: z.literal(asset)
          })
        }
      }
    }
  }
});

app.openapi(configRoute, (c) =>
  c.json({
    creditPurchasesEnabled: paymentsConfigured(c.env),
    cashoutsEnabled: cashoutsConfigured(c.env),
    chain,
    asset
  })
);

const walletSetupRoute = createRoute({
  method: "post",
  path: "/api/payments/wallet/setup",
  request: {
    body: {
      content: {
        "application/json": {
          schema: walletSetupRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "USDC payment profile",
      content: {
        "application/json": {
          schema: z.object({
            chain: z.literal(chain),
            asset: z.literal(asset),
            depositAddress: z.string(),
            withdrawalAddress: z.string().nullable(),
            privyUserId: z.string().nullable()
          })
        }
      }
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    403: { description: "Payments disabled", content: { "application/json": { schema: errorResponseSchema } } }
  }
});

app.openapi(walletSetupRoute, async (c) => {
  if (!cashoutsConfigured(c.env)) {
    return jsonError(c, "USDC payments are temporarily unavailable because Coinbase CDP is not fully configured.", 403);
  }

  const userId = await getSessionUserId(c.env, c.req.raw);
  if (!userId) {
    return jsonError(c, "Sign in before setting up a USDC wallet.", 401);
  }

  const body = c.req.valid("json");
  const profile = await ensurePaymentProfile(c.env, userId, body);
  return c.json({
    chain,
    asset,
    depositAddress: profile.depositAddress,
    withdrawalAddress: profile.withdrawalAddress,
    privyUserId: profile.privyUserId
  });
});

async function createOnramp(c: any) {
  if (!paymentsConfigured(c.env)) {
    return jsonError(c, "USDC deposits are temporarily unavailable because Coinbase Onramp is not fully configured.", 403);
  }

  const userId = await getSessionUserId(c.env, c.req.raw);
  if (!userId) {
    return jsonError(c, "Sign in before adding USDC.", 401);
  }

  const { amountCents } = c.req.valid("json");
  const profile = await ensurePaymentProfile(c.env, userId);
  if (!profile.depositAddress) {
    return jsonError(c, "Set up a deposit wallet before adding USDC.", 403);
  }

  const session = await cdpApiRequest<{ session: { onrampUrl: string } }>(c.env, "POST", "/platform/v2/onramp/sessions", {
    purchaseCurrency: asset,
    destinationNetwork: chain,
    destinationAddress: profile.depositAddress,
    paymentCurrency: "USD",
    paymentAmount: amountCents ? (amountCents / 100).toFixed(2) : undefined,
    redirectUrl: c.env.COINBASE_ONRAMP_REDIRECT_URL ?? c.env.BETTER_AUTH_URL ?? "https://moltbooky.com/credits",
    clientIp: c.req.header("cf-connecting-ip"),
    partnerUserRef: userId
  });

  return c.json({
    onrampUrl: session.session.onrampUrl,
    depositAddress: profile.depositAddress,
    chain,
    asset
  });
}

const onrampSessionRoute = createRoute({
  method: "post",
  path: "/api/payments/onramp-session",
  request: {
    body: {
      content: {
        "application/json": {
          schema: onrampSessionRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Coinbase Onramp URL",
      content: {
        "application/json": {
          schema: z.object({
            onrampUrl: z.string().url(),
            depositAddress: z.string(),
            chain: z.literal(chain),
            asset: z.literal(asset)
          })
        }
      }
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    403: { description: "Payments disabled", content: { "application/json": { schema: errorResponseSchema } } }
  }
});

app.openapi(onrampSessionRoute, createOnramp);

const creditPurchasesAliasRoute = createRoute({
  method: "post",
  path: "/api/payments/credit-purchases",
  request: {
    body: {
      content: {
        "application/json": {
          schema: onrampSessionRequestSchema
        }
      }
    }
  },
  responses: onrampSessionRoute.responses
});

app.openapi(creditPurchasesAliasRoute, createOnramp);

const depositsAliasRoute = createRoute({
  method: "post",
  path: "/api/payments/deposits",
  request: {
    body: {
      content: {
        "application/json": {
          schema: onrampSessionRequestSchema
        }
      }
    }
  },
  responses: onrampSessionRoute.responses
});

app.openapi(depositsAliasRoute, createOnramp);

const depositSyncRoute = createRoute({
  method: "post",
  path: "/api/payments/deposits/sync",
  responses: {
    200: {
      description: "Synced Base USDC deposits",
      content: {
        "application/json": {
          schema: z.object({
            creditedCents: z.number().int(),
            deposits: z.number().int(),
            scannedToBlock: z.number().int()
          })
        }
      }
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    403: { description: "Payments disabled", content: { "application/json": { schema: errorResponseSchema } } }
  }
});

app.openapi(depositSyncRoute, async (c) => {
  if (!paymentsConfigured(c.env)) {
    return jsonError(c, "USDC deposits are temporarily unavailable because Base RPC is not fully configured.", 403);
  }

  const userId = await getSessionUserId(c.env, c.req.raw);
  if (!userId) {
    return jsonError(c, "Sign in before syncing deposits.", 401);
  }

  const profile = await ensurePaymentProfile(c.env, userId);
  const { logs, scannedToBlock } = await scanDepositLogs(c.env, profile);
  const result = await creditDepositLogs(c.env, profile, logs, scannedToBlock);
  return c.json({ ...result, scannedToBlock });
});

const connectStatusRoute = createRoute({
  method: "get",
  path: "/api/payments/connect/status",
  responses: {
    200: {
      description: "USDC wallet status",
      content: {
        "application/json": {
          schema: z.object({
            cashoutsEnabled: z.boolean(),
            connected: z.boolean(),
            payoutsEnabled: z.boolean(),
            onboardingRequired: z.boolean(),
            withdrawalAddress: z.string().nullable()
          })
        }
      }
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } }
  }
});

app.openapi(connectStatusRoute, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw);
  if (!userId) {
    return jsonError(c, "Sign in before checking wallet setup.", 401);
  }

  const profile = await getProfile(c.env, userId);
  const connected = Boolean(profile?.withdrawalAddress);
  return c.json({
    cashoutsEnabled: cashoutsConfigured(c.env),
    connected,
    payoutsEnabled: connected,
    onboardingRequired: !connected,
    withdrawalAddress: profile?.withdrawalAddress ?? null
  });
});

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
  responses: {
    201: {
      description: "USDC withdrawal sent",
      content: {
        "application/json": {
          schema: z.object({
            wallet: z.object({
              userId: z.string(),
              availableCents: z.number().int(),
              lockedCents: z.number().int(),
              pendingWithdrawalCents: z.number().int()
            }),
            transactionHash: z.string(),
            withdrawalAddress: z.string()
          })
        }
      }
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
    403: { description: "Cashouts disabled or wallet missing", content: { "application/json": { schema: errorResponseSchema } } }
  }
});

app.openapi(withdrawalRoute, async (c) => {
  if (!cashoutsConfigured(c.env)) {
    return jsonError(c, "USDC cashouts are temporarily unavailable because Coinbase CDP is not fully configured.", 403);
  }

  const userId = await getSessionUserId(c.env, c.req.raw);
  if (!userId) {
    return jsonError(c, "Sign in before cashing out.", 401);
  }

  const { amountCents, withdrawalAddress } = c.req.valid("json");
  const profile = await ensurePaymentProfile(c.env, userId, { withdrawalAddress });
  const destination = normalizeAddress(withdrawalAddress ?? profile.withdrawalAddress ?? "");
  const ledgerId = newId("led");
  const cryptoTxId = newId("ctx");
  const pendingTxHash = `pending:${ledgerId}`;
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
      idempotencyKey: `base-usdc-withdrawal:${ledgerId}`,
      description: "Base USDC cashout sent"
    });

    await tx.insert(cryptoTransactions).values({
      id: cryptoTxId,
      direction: "withdrawal",
      userId,
      txHash: pendingTxHash,
      logIndex: 0,
      amountMicroUsdc: centsToMicroUsdc(amountCents).toString(),
      amountCents,
      status: "pending",
      providerRef: ledgerId
    });
  });

  if (!walletResponse) {
    throw new Error("Credit account could not be updated.");
  }

  try {
    const source = await getWithdrawalAccount(c.env, profile);
    const transfer = await source.transfer({
      to: destination,
      amount: centsToMicroUsdc(amountCents),
      token: "usdc",
      network: chain
    });
    const transactionHash = transfer.transactionHash.toLowerCase();

    await db.transaction(async (tx) => {
      const wallet = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for("update").limit(1);
      if (!wallet[0]) {
        throw new Error("Credit account not found.");
      }
      const updated = await tx
        .update(walletAccounts)
        .set({
          pendingWithdrawalCents: Math.max(0, wallet[0].pendingWithdrawalCents - amountCents),
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

      await tx
        .update(cryptoTransactions)
        .set({
          txHash: transactionHash,
          status: "confirmed",
          providerRef: source.address,
          updatedAt: new Date()
        })
        .where(eq(cryptoTransactions.id, cryptoTxId));
    });

    return c.json({ wallet: walletResponse, transactionHash, withdrawalAddress: destination }, 201);
  } catch (error) {
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

      await tx
        .update(cryptoTransactions)
        .set({
          status: "failed",
          providerRef: errorMessage(error, "CDP transfer failed."),
          updatedAt: new Date()
        })
        .where(eq(cryptoTransactions.id, cryptoTxId));
    });
    throw error;
  }
});

export default app;
