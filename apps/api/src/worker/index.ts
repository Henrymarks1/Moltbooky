import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { availableToMatch, oppositeSide, settleChallenge, validateChallengeInput, validateMatchAmount } from "@moltbooky/core/domain/challenge";
import { DEFAULT_AGENT_POLICY, createApiKeySecret, hashApiKey } from "@moltbooky/core/domain/apiKeys";
import { creditsToCents } from "@moltbooky/core/domain/money";
import type { Challenge, ChallengeMatch, Side } from "@moltbooky/core/domain/types";
import { and, apiKeys, challengeMatches, challenges, createDb, desc, eq, ledgerEntries, pipedreamConnections, walletAccounts } from "@moltbooky/db";
import {
  actorFromRequest,
  ensureBetaUser,
  getChallenge,
  getWallet,
  json,
  listChallenges,
  listUserChallenges,
  listUserMatches,
  listMatches,
  listResolutionRuns,
  lockFunds,
  newId,
  parseSide,
  requireScope
} from "./db";
import { createAuth } from "./auth";

const app = new OpenAPIHono<{ Bindings: Env }>();

app.onError((error) => json({ error: error.message }, { status: 400 }));

const errorResponseSchema = z.object({
  error: z.string()
});

const sideSchema = z.enum(["YES", "NO"]);
const challengeVisibilitySchema = z.enum(["public", "private"]);
const dateTimeSchema = z.string().datetime();
const jsonRecordSchema = z.record(z.string(), z.unknown());
const resolutionToolSchema = z.object({
  type: z.literal("pipedream_action"),
  appSlug: z.string().trim().min(1).max(80),
  appName: z.string().trim().max(120).optional(),
  authPropName: z.string().trim().min(1).max(80),
  accountId: z.string().trim().max(120).optional(),
  actionKey: z.string().trim().min(1).max(180),
  configuredProps: jsonRecordSchema.optional(),
  instructions: z.string().trim().max(2000).optional()
});
const resolutionToolsSchema = z.array(resolutionToolSchema).max(8);
const pipedreamConnectionIdsSchema = z.array(z.string().trim().min(1).max(120)).max(8).default([]);
const requestDateTimeSchema = z.string().trim().transform((value, ctx) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    ctx.addIssue({
      code: "custom",
      message: "Invalid datetime."
    });
    return z.NEVER;
  }
  return date.toISOString();
});
const centsSchema = z.number().int().min(0);
const betaStakeCentsSchema = z.number().int().min(500).max(10_000);

const challengeSchema = z.object({
  id: z.string(),
  creatorId: z.string(),
  claim: z.string(),
  resolutionCriteria: z.string(),
  resolutionTool: z.union([resolutionToolSchema, resolutionToolsSchema]).nullable().optional(),
  pipedreamConnectionIds: z.array(z.string()),
  creatorSide: sideSchema,
  visibility: challengeVisibilitySchema,
  stakeCents: centsSchema,
  matchedCents: centsSchema,
  status: z.enum([
    "draft",
    "open",
    "resolving",
    "provisional_resolved",
    "final_resolved",
    "cancelled",
    "expired_unmatched",
    "voided",
    "disputed"
  ]),
  expiresAt: dateTimeSchema,
  disputeDeadlineAt: dateTimeSchema.nullable().optional(),
  provisionalOutcome: z.enum(["YES", "NO", "UNRESOLVED"]).nullable().optional(),
  createdAt: dateTimeSchema
});

const challengeMatchSchema = z.object({
  id: z.string(),
  challengeId: z.string(),
  matcherId: z.string(),
  matcherName: z.string().nullable().optional(),
  amountCents: betaStakeCentsSchema,
  side: sideSchema,
  status: z.enum(["active", "settled", "cancelled"]),
  createdAt: dateTimeSchema
});

const createdMatchSchema = z.object({
  id: z.string(),
  amountCents: betaStakeCentsSchema,
  side: sideSchema
});

const resolutionRunSchema = z.object({
  id: z.string(),
  challengeId: z.string(),
  exaQuery: z.string(),
  sourceUrls: z.array(z.string()),
  aiRationale: z.string(),
  proposedOutcome: z.enum(["YES", "NO", "UNRESOLVED"]),
  confidence: z.number().min(0).max(1),
  createdAt: dateTimeSchema
});

const walletSchema = z.object({
  userId: z.string(),
  availableCents: centsSchema,
  lockedCents: centsSchema,
  pendingWithdrawalCents: centsSchema
});

const ledgerEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  amountCents: z.number().int(),
  challengeId: z.string().nullable(),
  matchId: z.string().nullable(),
  description: z.string(),
  createdAt: dateTimeSchema
});

const creditValueSchema = z.union([z.string(), z.number()]);

const createChallengeRequestSchema = z
  .object({
    claim: z.string().min(1),
    resolutionCriteria: z.string().min(1),
    resolutionTool: z.union([resolutionToolSchema, resolutionToolsSchema]).nullable().optional(),
    pipedreamConnectionIds: pipedreamConnectionIdsSchema.optional(),
    creatorSide: sideSchema,
    visibility: challengeVisibilitySchema.default("public"),
    stakeCredits: creditValueSchema.optional(),
    stakeDollars: creditValueSchema.optional(),
    stakeCents: betaStakeCentsSchema.optional(),
    expiresAt: requestDateTimeSchema
  })
  .refine((value) => value.stakeCredits !== undefined || value.stakeDollars !== undefined || value.stakeCents !== undefined, {
    message: "stakeCredits or stakeCents is required."
  });
const challengeDraftDataSchema = z.object({
  claim: z.string().optional(),
  resolutionCriteria: z.string().optional(),
  creatorSide: sideSchema.optional(),
  visibility: challengeVisibilitySchema.optional(),
  stakeCredits: z.string().optional(),
  expiresAt: z.string().optional(),
  pipedreamConnectionIds: pipedreamConnectionIdsSchema.optional()
});
const saveChallengeDraftRequestSchema = z.object({
  draft: challengeDraftDataSchema
});
const challengeDraftResponseSchema = z.object({
  id: z.string(),
  draft: challengeDraftDataSchema
});

const createMatchRequestSchema = z
  .object({
    amountCredits: creditValueSchema.optional(),
    amountDollars: creditValueSchema.optional(),
    amountCents: betaStakeCentsSchema.optional()
  })
  .refine((value) => value.amountCredits !== undefined || value.amountDollars !== undefined || value.amountCents !== undefined, {
    message: "amountCredits or amountCents is required."
  });

const createApiKeyRequestSchema = z.object({
  name: z.string().optional()
});

const pipedreamTokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string().optional(),
  connectLinkUrl: z.string().optional(),
  externalUserId: z.string()
});
const pipedreamAppSchema = z.object({
  id: z.string(),
  nameSlug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  imgSrc: z.string().optional(),
  categories: z.array(z.string()).optional(),
  authType: z.string().optional()
});
const pipedreamConnectionSchema = z.object({
  id: z.string(),
  appSlug: z.string(),
  appName: z.string(),
  accountId: z.string(),
  authPropName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
const savePipedreamConnectionRequestSchema = z.object({
  appSlug: z.string().trim().min(1).max(80),
  appName: z.string().trim().min(1).max(120),
  accountId: z.string().trim().min(1).max(120),
  authPropName: z.string().trim().min(1).max(80)
});

const finalizeChallengeRequestSchema = z.object({
  outcome: sideSchema
});

const idParamSchema = z.object({
  id: z.string()
});

const errorResponses = {
  400: {
    description: "Bad request",
    content: { "application/json": { schema: errorResponseSchema } }
  },
  401: {
    description: "Unauthorized",
    content: { "application/json": { schema: errorResponseSchema } }
  },
  403: {
    description: "Forbidden",
    content: { "application/json": { schema: errorResponseSchema } }
  },
  404: {
    description: "Not found",
    content: { "application/json": { schema: errorResponseSchema } }
  }
} as const;

const agentSkillMarkdown = `# Moltbooky Agent Skill

Moltbooky is a private-beta 1:1 challenge-betting platform. It is not an AMM and not an order book.

## Core Rules

- Challenges are binary: YES or NO.
- A creator posts a claim, resolution criteria, a creator side, credit stake, and expiry.
- Matchers can only take the opposite side.
- Odds are always 1:1.
- Users buy platform credits before creating or matching challenges.
- Only matched credits are at risk.
- Unmatched creator credits can be released while the challenge is open.
- Minimum stake is 5 credits.
- Private beta max stake is 100 credits.
- Platform fee is 2% of profit only.
- AI resolution is provisional and may be disputed.
- Markets may attach one Pipedream action as a resolution tool for authenticated evidence such as Strava or LinkedIn data.
- Credit purchases use Base USDC when Coinbase CDP, Coinbase Onramp, and Base RPC are configured.

## Agent Operating Policy

- Act only for the user who owns your API key.
- Do not create or match a challenge unless the user clearly instructed you to do so.
- Before creating a challenge, restate the claim, resolution criteria, side, stake, and expiry.
- Do not invent live market data.
- Do not imply guaranteed returns.
- Treat all unresolved outcomes as unresolved until the platform finalizes them.
- If evidence is ambiguous, prefer no action or UNRESOLVED.

## Authentication

Agents authenticate with a user-owned API key:

\`\`\`http
Authorization: Bearer mbk_...
\`\`\`

Human browser sessions use Better Auth at \`/api/auth/*\`.

## Useful Endpoints

- \`GET /api/health\` - API health check.
- \`GET /api/challenges\` - list public challenges.
- \`GET /api/my/challenges\` - list challenges you created or matched.
- \`GET /api/challenges/:id\` - read challenge details and matches.
- \`POST /api/challenges\` - create a challenge.
- \`POST /api/challenges/:id/matches\` - match the opposite side.
- \`POST /api/challenges/:id/cancel-unmatched\` - release unmatched creator stake.
- \`DELETE /api/challenges/:id\` - delete your own challenge if it has no matches.
- \`GET /api/wallet\` - read platform credit balances.
- \`GET /api/ledger\` - read ledger entries.
- \`POST /api/api-keys\` - create an API key from a human session.
- \`DELETE /api/api-keys/:id\` - revoke an API key.
- \`GET /api/openapi.json\` - OpenAPI 3.1 API contract.

## Create Challenge Body

\`\`\`json
{
  "claim": "Will the stated event happen by the expiry?",
  "resolutionCriteria": "Resolve YES only if ...",
  "resolutionTool": {
    "type": "pipedream_action",
    "appSlug": "strava",
    "appName": "Strava",
    "authPropName": "strava",
    "accountId": "apn_...",
    "actionKey": "strava-list-activities",
    "configuredProps": {},
    "instructions": "Use this action only to verify the user's relevant activity."
  },
  "creatorSide": "YES",
  "visibility": "public",
  "stakeCredits": "25.00",
  "expiresAt": "2026-06-30T23:59:00.000Z"
}
\`\`\`

## Match Body

\`\`\`json
{
  "amountCredits": "10.00"
}
\`\`\`

## Response Handling

- If the API returns an auth error, ask the user to sign in or provide a valid scoped API key.
- If credit purchase endpoints report missing USDC payment configuration, ask the user to configure Coinbase CDP, Coinbase Onramp, and Base RPC before retrying.
- If a challenge is closed, cancelled, voided, disputed, or resolved, do not attempt to match it.
- If a request fails validation, show the user the exact correction needed.
`;

function errorJson(c: any, message: string, status: 400 | 401 | 403 | 404) {
  return c.json({ error: message }, status) as any;
}

function pipedreamEnabled(env: Env): boolean {
  return Boolean(env.PIPEDREAM_CLIENT_ID && env.PIPEDREAM_CLIENT_SECRET && env.PIPEDREAM_PROJECT_ID);
}

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

async function pipedreamAccessToken(env: Env, scope: string): Promise<string> {
  if (!pipedreamEnabled(env)) {
    throw new Error("Pipedream Connect is not configured.");
  }

  const response = await fetch("https://api.pipedream.com/v1/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: env.PIPEDREAM_CLIENT_ID,
      client_secret: env.PIPEDREAM_CLIENT_SECRET,
      scope
    })
  });

  const data = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error ?? "Could not authenticate with Pipedream.");
  }
  return data.access_token;
}

async function currentActor(env: Env, request: Request): Promise<{ userId: string; scopes: string[] }> {
  try {
    return await actorFromRequest(env, request);
  } catch (error) {
    if (!isLocalRequest(request) || !(error as Error).message.includes("BETTER_AUTH_SECRET")) {
      throw error;
    }

    const userId = request.headers.get("x-user-id") ?? "local-dev-user";
    await ensureBetaUser(env, userId);
    return { userId, scopes: ["*"] };
  }
}

function uniquePipedreamConnectionIds(ids: string[] = []): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))).slice(0, 8);
}

async function validateUserPipedreamConnectionIds(env: Env, userId: string, ids: string[] = []): Promise<string[]> {
  const connectionIds = uniquePipedreamConnectionIds(ids);
  if (connectionIds.length === 0) {
    return [];
  }

  const db = createDb(env.DATABASE_URL);
  const rows = await db
    .select({ id: pipedreamConnections.id })
    .from(pipedreamConnections)
    .where(eq(pipedreamConnections.userId, userId));
  const ownedIds = new Set(rows.map((row) => row.id));
  const missingId = connectionIds.find((id) => !ownedIds.has(id));
  if (missingId) {
    throw new Error(`Pipedream connection ${missingId} was not found for this user.`);
  }
  return connectionIds;
}

async function applyWalletDelta(tx: any, userId: string, availableDeltaCents: number, lockedDeltaCents: number): Promise<void> {
  const wallet = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for("update").limit(1);
  if (!wallet[0]) {
    throw new Error("Credit account not found.");
  }

  await tx
    .update(walletAccounts)
    .set({
      availableCents: wallet[0].availableCents + availableDeltaCents,
      lockedCents: wallet[0].lockedCents + lockedDeltaCents,
      updatedAt: new Date()
    })
    .where(eq(walletAccounts.userId, userId));
}

app.doc("/api/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Moltbooky API",
    version: "0.1.0",
    description:
      "Private-beta 1:1 challenge-betting API. Creators stake a binary YES/NO claim and matchers take the opposite side at even odds."
  }
});

app.get("/skill.md", () => new Response(agentSkillMarkdown, { headers: { "content-type": "text/markdown; charset=utf-8" } }));

const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  responses: {
    200: {
      description: "Health check",
      content: {
        "application/json": {
          schema: z.object({
            ok: z.boolean(),
            name: z.string()
          })
        }
      }
    }
  }
});

app.openapi(healthRoute, (c) => c.json({ ok: true, name: "Moltbooky" }));

app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

const pipedreamConfigRoute = createRoute({
  method: "get",
  path: "/api/integrations/pipedream/config",
  responses: {
    200: {
      description: "Pipedream Connect configuration state",
      content: {
        "application/json": {
          schema: z.object({
            enabled: z.boolean(),
            environment: z.string()
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(pipedreamConfigRoute, (c) =>
  c.json({
    enabled: pipedreamEnabled(c.env),
    environment: c.env.PIPEDREAM_PROJECT_ENVIRONMENT ?? "development"
  })
);

const listPipedreamAppsRoute = createRoute({
  method: "get",
  path: "/api/integrations/pipedream/apps",
  responses: {
    200: {
      description: "Pipedream apps available for Connect",
      content: {
        "application/json": {
          schema: z.object({
            apps: z.array(pipedreamAppSchema)
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(listPipedreamAppsRoute, async (c) => {
  const accessToken = await pipedreamAccessToken(c.env, "connect:tokens:create");
  const query = c.req.query("q")?.trim();
  const params = new URLSearchParams({
    limit: "100",
    has_actions: "true",
    sort_key: "featured_weight",
    sort_direction: "desc"
  });
  if (query) {
    params.set("q", query);
  }

  const response = await fetch(`https://api.pipedream.com/v1/connect/apps?${params.toString()}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-pd-environment": c.env.PIPEDREAM_PROJECT_ENVIRONMENT ?? "development"
    }
  });
  const data = (await response.json().catch(() => ({}))) as {
    data?: Array<{
      id?: string;
      name_slug?: string;
      name?: string;
      description?: string;
      img_src?: string;
      categories?: string[];
      auth_type?: string;
    }>;
    error?: string;
  };

  if (!response.ok || !data.data) {
    throw new Error(data.error ?? "Could not list Pipedream apps.");
  }

  const apps = data.data
    .filter((app) => app.id && app.name_slug && app.name)
    .map((app) => ({
      id: app.id!,
      nameSlug: app.name_slug!,
      name: app.name!,
      description: app.description,
      imgSrc: app.img_src,
      categories: app.categories,
      authType: app.auth_type
    }));

  return c.json({ apps });
});

const listPipedreamConnectionsRoute = createRoute({
  method: "get",
  path: "/api/integrations/pipedream/connections",
  responses: {
    200: {
      description: "Saved Pipedream connections for the current user",
      content: {
        "application/json": {
          schema: z.object({
            connections: z.array(pipedreamConnectionSchema)
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(listPipedreamConnectionsRoute, async (c) => {
  const actor = await currentActor(c.env, c.req.raw);
  const db = createDb(c.env.DATABASE_URL);
  const rows = await db
    .select()
    .from(pipedreamConnections)
    .where(eq(pipedreamConnections.userId, actor.userId))
    .orderBy(desc(pipedreamConnections.updatedAt));

  return c.json({
    connections: rows.map((row) => ({
      id: row.id,
      appSlug: row.appSlug,
      appName: row.appName,
      accountId: row.accountId,
      authPropName: row.authPropName,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt
    }))
  });
});

const savePipedreamConnectionRoute = createRoute({
  method: "post",
  path: "/api/integrations/pipedream/connections",
  request: {
    body: {
      content: {
        "application/json": {
          schema: savePipedreamConnectionRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: "Saved Pipedream connection",
      content: {
        "application/json": {
          schema: z.object({
            connection: pipedreamConnectionSchema
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(savePipedreamConnectionRoute, async (c) => {
  const actor = await currentActor(c.env, c.req.raw);
  const body = c.req.valid("json");
  const db = createDb(c.env.DATABASE_URL);
  const now = new Date();
  const rows = await db
    .insert(pipedreamConnections)
    .values({
      id: newId("pdc"),
      userId: actor.userId,
      appSlug: body.appSlug,
      appName: body.appName,
      accountId: body.accountId,
      authPropName: body.authPropName,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [pipedreamConnections.userId, pipedreamConnections.appSlug],
      set: {
        appName: body.appName,
        accountId: body.accountId,
        authPropName: body.authPropName,
        updatedAt: now
      }
    })
    .returning();
  const connection = rows[0];

  return c.json(
    {
      connection: {
        id: connection.id,
        appSlug: connection.appSlug,
        appName: connection.appName,
        accountId: connection.accountId,
        authPropName: connection.authPropName,
        createdAt: connection.createdAt instanceof Date ? connection.createdAt.toISOString() : connection.createdAt,
        updatedAt: connection.updatedAt instanceof Date ? connection.updatedAt.toISOString() : connection.updatedAt
      }
    },
    201
  );
});

const createPipedreamTokenRoute = createRoute({
  method: "post",
  path: "/api/integrations/pipedream/connect-token",
  responses: {
    201: {
      description: "Short-lived Pipedream Connect token for the current user",
      content: {
        "application/json": {
          schema: pipedreamTokenResponseSchema
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(createPipedreamTokenRoute, async (c) => {
  const actor = await currentActor(c.env, c.req.raw);

  const accessToken = await pipedreamAccessToken(c.env, "connect:tokens:create");
  const allowedOrigins = c.env.PIPEDREAM_ALLOWED_ORIGINS ? JSON.parse(c.env.PIPEDREAM_ALLOWED_ORIGINS) : undefined;
  const response = await fetch(`https://api.pipedream.com/v1/connect/${c.env.PIPEDREAM_PROJECT_ID}/tokens`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
      "x-pd-environment": c.env.PIPEDREAM_PROJECT_ENVIRONMENT ?? "development"
    },
    body: JSON.stringify({
      external_user_id: actor.userId,
      allowed_origins: allowedOrigins,
      scope: "connect:*"
    })
  });
  const data = (await response.json().catch(() => ({}))) as { token?: string; expires_at?: string; connect_link_url?: string; error?: string };
  if (!response.ok || !data.token) {
    throw new Error(data.error ?? "Could not create a Pipedream Connect token.");
  }
  return c.json({ token: data.token, expiresAt: data.expires_at, connectLinkUrl: data.connect_link_url, externalUserId: actor.userId }, 201);
});

const getChallengeDraftRoute = createRoute({
  method: "get",
  path: "/api/challenges/draft",
  responses: {
    200: {
      description: "Current user's challenge draft",
      content: {
        "application/json": {
          schema: z.object({
            challenge: challengeDraftResponseSchema.nullable()
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(getChallengeDraftRoute, async (c) => {
  const actor = await currentActor(c.env, c.req.raw);
  const db = createDb(c.env.DATABASE_URL);
  const rows = await db
    .select()
    .from(challenges)
    .where(and(eq(challenges.creatorId, actor.userId), eq(challenges.status, "draft")))
    .orderBy(desc(challenges.updatedAt))
    .limit(1);
  if (!rows[0]) {
    return c.json({ challenge: null });
  }

  const draft: z.infer<typeof challengeDraftDataSchema> = {
    claim: rows[0].claim,
    resolutionCriteria: rows[0].resolutionCriteria,
    creatorSide: rows[0].creatorSide as z.infer<typeof sideSchema>,
    visibility: rows[0].visibility as z.infer<typeof challengeVisibilitySchema>,
    stakeCredits: rows[0].stakeCents > 0 ? (rows[0].stakeCents / 100).toFixed(2) : "",
    expiresAt: rows[0].expiresAt instanceof Date ? rows[0].expiresAt.toISOString() : String(rows[0].expiresAt),
    pipedreamConnectionIds: rows[0].pipedreamConnectionIds ?? []
  };
  return c.json({ challenge: { id: rows[0].id, draft } });
});

const saveChallengeDraftRoute = createRoute({
  method: "put",
  path: "/api/challenges/draft",
  request: {
    body: {
      content: {
        "application/json": {
          schema: saveChallengeDraftRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Saved challenge draft",
      content: {
        "application/json": {
          schema: z.object({
            challenge: challengeDraftResponseSchema
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(saveChallengeDraftRoute, async (c) => {
  const actor = await currentActor(c.env, c.req.raw);
  const body = c.req.valid("json");
  const db = createDb(c.env.DATABASE_URL);
  const now = new Date();
  const pipedreamConnectionIds = await validateUserPipedreamConnectionIds(c.env, actor.userId, body.draft.pipedreamConnectionIds);
  const existing = await db
    .select({ id: challenges.id })
    .from(challenges)
    .where(and(eq(challenges.creatorId, actor.userId), eq(challenges.status, "draft")))
    .orderBy(desc(challenges.updatedAt))
    .limit(1);
  const expiresAt = body.draft.expiresAt && !Number.isNaN(new Date(body.draft.expiresAt).getTime()) ? new Date(body.draft.expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const stakeCents = body.draft.stakeCredits && /^\d+(\.\d{1,2})?$/.test(body.draft.stakeCredits) ? creditsToCents(body.draft.stakeCredits) : 0;
  const draft = {
    ...body.draft,
    pipedreamConnectionIds
  };

  let challengeId = existing[0]?.id;
  if (challengeId) {
    await db
      .update(challenges)
      .set({
        claim: body.draft.claim ?? "",
        resolutionCriteria: body.draft.resolutionCriteria ?? "",
        resolutionTool: null,
        pipedreamConnectionIds,
        creatorSide: body.draft.creatorSide ?? "YES",
        visibility: body.draft.visibility ?? "public",
        stakeCents,
        expiresAt,
        updatedAt: now
      })
      .where(eq(challenges.id, challengeId));
  } else {
    challengeId = newId("ch");
    await db.insert(challenges).values({
      id: challengeId,
      creatorId: actor.userId,
      claim: body.draft.claim ?? "",
      resolutionCriteria: body.draft.resolutionCriteria ?? "",
      resolutionTool: null,
      pipedreamConnectionIds,
      creatorSide: body.draft.creatorSide ?? "YES",
      visibility: body.draft.visibility ?? "public",
      stakeCents,
      status: "draft",
      expiresAt,
      updatedAt: now
    });
  }

  return c.json({ challenge: { id: challengeId, draft } });
});

const deleteChallengeDraftRoute = createRoute({
  method: "delete",
  path: "/api/challenges/draft",
  responses: {
    200: {
      description: "Deleted challenge draft",
      content: {
        "application/json": {
          schema: z.object({
            deleted: z.boolean()
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(deleteChallengeDraftRoute, async (c) => {
  const actor = await currentActor(c.env, c.req.raw);
  const db = createDb(c.env.DATABASE_URL);
  await db.delete(challenges).where(and(eq(challenges.creatorId, actor.userId), eq(challenges.status, "draft")));
  return c.json({ deleted: true });
});

const listChallengesRoute = createRoute({
  method: "get",
  path: "/api/challenges",
  responses: {
    200: {
      description: "List recent challenges",
      content: {
        "application/json": {
          schema: z.object({
            challenges: z.array(challengeSchema)
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(listChallengesRoute, async (c) => {
  return c.json({ challenges: await listChallenges(c.env) });
});

const listMyChallengesRoute = createRoute({
  method: "get",
  path: "/api/my/challenges",
  responses: {
    200: {
      description: "List challenges created or matched by the current user",
      content: {
        "application/json": {
          schema: z.object({
            challenges: z.array(challengeSchema),
            matches: z.array(challengeMatchSchema)
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(listMyChallengesRoute, async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  requireScope(actor, "challenges:read");
  return c.json({
    challenges: await listUserChallenges(c.env, actor.userId),
    matches: await listUserMatches(c.env, actor.userId)
  });
});

const createChallengeRoute = createRoute({
  method: "post",
  path: "/api/challenges",
  request: {
    body: {
      content: {
        "application/json": {
          schema: createChallengeRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: "Created challenge",
      content: {
        "application/json": {
          schema: z.object({
            challenge: challengeSchema.nullable()
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(createChallengeRoute, async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  requireScope(actor, "challenges:create");

  const body = c.req.valid("json");
  const stakeCents = body.stakeCents ?? creditsToCents(body.stakeCredits ?? body.stakeDollars ?? "");
  const creatorSide = parseSide(body.creatorSide);
  const pipedreamConnectionIds = await validateUserPipedreamConnectionIds(c.env, actor.userId, body.pipedreamConnectionIds);
  const db = createDb(c.env.DATABASE_URL);
  const existingDraft = await db
    .select({ id: challenges.id })
    .from(challenges)
    .where(and(eq(challenges.creatorId, actor.userId), eq(challenges.status, "draft")))
    .orderBy(desc(challenges.updatedAt))
    .limit(1);
  const challengeId = existingDraft[0]?.id ?? newId("ch");

  validateChallengeInput({
    claim: body.claim ?? "",
    resolutionCriteria: body.resolutionCriteria ?? "",
    stakeCents,
    expiresAt: body.expiresAt ?? ""
  });

  await lockFunds({
    env: c.env,
    userId: actor.userId,
    amountCents: stakeCents,
    type: "lock",
    challengeId,
    description: "Lock creator challenge stake",
    idempotencyKey: `challenge-create:${challengeId}`
  });

  const challengeValues = {
    claim: body.claim!.trim(),
    resolutionCriteria: body.resolutionCriteria!.trim(),
    resolutionTool: body.resolutionTool ? JSON.stringify(body.resolutionTool) : null,
    pipedreamConnectionIds,
    creatorSide,
    visibility: body.visibility,
    stakeCents,
    status: "open",
    expiresAt: new Date(body.expiresAt!),
    updatedAt: new Date()
  };

  if (existingDraft[0]) {
    await db.update(challenges).set(challengeValues).where(eq(challenges.id, challengeId));
  } else {
    await db.insert(challenges).values({
      id: challengeId,
      creatorId: actor.userId,
      ...challengeValues
    });
  }

  return c.json({ challenge: await getChallenge(c.env, challengeId) }, 201);
});

const getChallengeRoute = createRoute({
  method: "get",
  path: "/api/challenges/{id}",
  request: {
    params: idParamSchema
  },
  responses: {
    200: {
      description: "Challenge detail",
      content: {
        "application/json": {
          schema: z.object({
            challenge: challengeSchema,
            matches: z.array(challengeMatchSchema),
            resolutionRuns: z.array(resolutionRunSchema),
            availableToMatchCents: centsSchema
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(getChallengeRoute, async (c) => {
  const { id } = c.req.valid("param");
  const challenge = await getChallenge(c.env, id);
  if (!challenge) {
    return errorJson(c, "Challenge not found.", 404);
  }
  return c.json({
    challenge,
    matches: await listMatches(c.env, challenge.id),
    resolutionRuns: await listResolutionRuns(c.env, challenge.id),
    availableToMatchCents: availableToMatch(challenge)
  });
});

const createMatchRoute = createRoute({
  method: "post",
  path: "/api/challenges/{id}/matches",
  request: {
    params: idParamSchema,
    body: {
      content: {
        "application/json": {
          schema: createMatchRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: "Created match",
      content: {
        "application/json": {
          schema: z.object({
            challenge: challengeSchema.nullable(),
            match: createdMatchSchema
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(createMatchRoute, async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  requireScope(actor, "matches:create");

  const body = c.req.valid("json");
  const { id } = c.req.valid("param");
  const challenge = await getChallenge(c.env, id);
  if (!challenge) {
    return errorJson(c, "Challenge not found.", 404);
  }
  if (challenge.creatorId === actor.userId) {
    throw new Error("Creator cannot match their own challenge.");
  }

  const amountCents = body.amountCents ?? creditsToCents(body.amountCredits ?? body.amountDollars ?? "");
  validateMatchAmount(challenge, amountCents);

  const durableId = c.env.CHALLENGE_OBJECT.idFromName(challenge.id);
  const object = c.env.CHALLENGE_OBJECT.get(durableId);
  return object.fetch(new Request("https://challenge-object/match", {
    method: "POST",
    body: JSON.stringify({ challengeId: challenge.id, matcherId: actor.userId, amountCents })
  })) as any;
});

const cancelUnmatchedRoute = createRoute({
  method: "post",
  path: "/api/challenges/{id}/cancel-unmatched",
  request: {
    params: idParamSchema
  },
  responses: {
    200: {
      description: "Released unmatched creator stake",
      content: {
        "application/json": {
          schema: z.object({
            challenge: challengeSchema,
            unlockedCents: centsSchema
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(cancelUnmatchedRoute, async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  const { id } = c.req.valid("param");
  const challenge = await getChallenge(c.env, id);
  if (!challenge) {
    return errorJson(c, "Challenge not found.", 404);
  }
  if (challenge.creatorId !== actor.userId) {
    throw new Error("Only the creator can cancel unmatched stake.");
  }
  const unmatched = availableToMatch(challenge);
  if (unmatched === 0) {
    return c.json({ challenge, unlockedCents: 0 });
  }

  const db = createDb(c.env.DATABASE_URL);
  await db.transaction(async (tx) => {
    await applyWalletDelta(tx, actor.userId, unmatched, -unmatched);
    await tx.insert(ledgerEntries).values({
      id: newId("led"),
      userId: actor.userId,
      type: "unlock",
      amountCents: unmatched,
      challengeId: challenge.id,
      idempotencyKey: `cancel-unmatched:${challenge.id}:${Date.now()}`,
      description: "Release unmatched creator stake"
    });
    await tx
      .update(challenges)
      .set({
        stakeCents: challenge.matchedCents,
        status: challenge.matchedCents === 0 ? "cancelled" : challenge.status,
        updatedAt: new Date()
      })
      .where(eq(challenges.id, challenge.id));
  });

  return c.json({ challenge: await getChallenge(c.env, challenge.id), unlockedCents: unmatched });
});

const deleteChallengeRoute = createRoute({
  method: "delete",
  path: "/api/challenges/{id}",
  request: {
    params: idParamSchema
  },
  responses: {
    200: {
      description: "Deleted unmatched creator challenge",
      content: {
        "application/json": {
          schema: z.object({
            deleted: z.boolean(),
            unlockedCents: centsSchema
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(deleteChallengeRoute, async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  requireScope(actor, "challenges:create");
  const { id } = c.req.valid("param");
  const db = createDb(c.env.DATABASE_URL);
  let unlockedCents = 0;

  await db.transaction(async (tx) => {
    const current = await tx.select().from(challenges).where(eq(challenges.id, id)).for("update").limit(1);
    const challenge = current[0];

    if (!challenge) {
      throw new Error("Challenge not found.");
    }
    if (challenge.creatorId !== actor.userId) {
      throw new Error("Only the creator can delete this challenge.");
    }
    if (challenge.matchedCents > 0) {
      throw new Error("Only challenges with no matches can be deleted.");
    }

    const existingMatches = await tx.select({ id: challengeMatches.id }).from(challengeMatches).where(eq(challengeMatches.challengeId, id)).limit(1);
    if (existingMatches.length > 0) {
      throw new Error("Only challenges with no matches can be deleted.");
    }

    unlockedCents = challenge.stakeCents;
    if (unlockedCents > 0) {
      await applyWalletDelta(tx, actor.userId, unlockedCents, -unlockedCents);
      await tx.insert(ledgerEntries).values({
        id: newId("led"),
        userId: actor.userId,
        type: "unlock",
        amountCents: unlockedCents,
        challengeId: challenge.id,
        idempotencyKey: `challenge-delete:${challenge.id}`,
        description: "Release deleted challenge stake"
      });
    }

    await tx.delete(challenges).where(eq(challenges.id, id));
  });

  return c.json({ deleted: true, unlockedCents });
});

const getWalletRoute = createRoute({
  method: "get",
  path: "/api/wallet",
  responses: {
    200: {
      description: "Current platform credit account",
      content: {
        "application/json": {
          schema: z.object({
            wallet: walletSchema
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(getWalletRoute, async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  requireScope(actor, "wallet:read");
  return c.json({ wallet: await getWallet(c.env, actor.userId) });
});

const getLedgerRoute = createRoute({
  method: "get",
  path: "/api/ledger",
  responses: {
    200: {
      description: "Recent ledger entries",
      content: {
        "application/json": {
          schema: z.object({
            ledger: z.array(ledgerEntrySchema)
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(getLedgerRoute, async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  requireScope(actor, "wallet:read");
  const db = createDb(c.env.DATABASE_URL);
  const ledgerRows = await db
    .select({
      id: ledgerEntries.id,
      type: ledgerEntries.type,
      amountCents: ledgerEntries.amountCents,
      challengeId: ledgerEntries.challengeId,
      matchId: ledgerEntries.matchId,
      description: ledgerEntries.description,
      createdAt: ledgerEntries.createdAt
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.userId, actor.userId))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(100);
  const ledger = ledgerRows.map((entry) => ({
    ...entry,
    createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt
  }));
  return c.json({ ledger });
});

const createApiKeyRoute = createRoute({
  method: "post",
  path: "/api/api-keys",
  request: {
    body: {
      required: false,
      content: {
        "application/json": {
          schema: createApiKeyRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: "Created API key. Secret is returned once.",
      content: {
        "application/json": {
          schema: z.object({
            apiKey: z.object({
              id: z.string(),
              secret: z.string(),
              policy: z.object({
                scopes: z.array(z.string()),
                maxStakeCents: centsSchema,
                dailyStakeLimitCents: centsSchema,
                allowCategories: z.array(z.string()),
                denyCategories: z.array(z.string())
              })
            })
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(createApiKeyRoute, async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  const body = c.req.valid("json") ?? {};
  const secret = createApiKeySecret();
  const id = newId("key");

  const db = createDb(c.env.DATABASE_URL);
  await db.insert(apiKeys).values({
    id,
    userId: actor.userId,
    name: body.name?.trim() || "Agent key",
    keyHash: await hashApiKey(secret),
    scopes: JSON.stringify(DEFAULT_AGENT_POLICY.scopes),
    maxStakeCents: DEFAULT_AGENT_POLICY.maxStakeCents,
    dailyStakeLimitCents: DEFAULT_AGENT_POLICY.dailyStakeLimitCents,
    allowCategories: JSON.stringify(DEFAULT_AGENT_POLICY.allowCategories),
    denyCategories: JSON.stringify(DEFAULT_AGENT_POLICY.denyCategories)
  });

  return c.json({ apiKey: { id, secret, policy: DEFAULT_AGENT_POLICY } }, 201);
});

const deleteApiKeyRoute = createRoute({
  method: "delete",
  path: "/api/api-keys/{id}",
  request: {
    params: idParamSchema
  },
  responses: {
    200: {
      description: "API key revoked",
      content: {
        "application/json": {
          schema: z.object({
            ok: z.boolean()
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(deleteApiKeyRoute, async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  const { id } = c.req.valid("param");
  const db = createDb(c.env.DATABASE_URL);
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, actor.userId)));
  return c.json({ ok: true });
});

const finalizeChallengeRoute = createRoute({
  method: "post",
  path: "/api/admin/challenges/{id}/finalize",
  request: {
    params: idParamSchema,
    body: {
      content: {
        "application/json": {
          schema: finalizeChallengeRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Finalized challenge",
      content: {
        "application/json": {
          schema: z.object({
            challenge: challengeSchema.nullable()
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(finalizeChallengeRoute, async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  if (actor.userId !== "admin") {
    return errorJson(c, "Admin only.", 403);
  }

  const body = c.req.valid("json");
  const outcome = parseSide(body.outcome);
  const { id } = c.req.valid("param");
  const challenge = await getChallenge(c.env, id);
  if (!challenge) {
    return errorJson(c, "Challenge not found.", 404);
  }
  const matches = await listMatches(c.env, challenge.id);
  await applySettlement(c.env, challenge, matches, outcome);
  return c.json({ challenge: await getChallenge(c.env, challenge.id) });
});

const voidChallengeRoute = createRoute({
  method: "post",
  path: "/api/admin/challenges/{id}/void",
  request: {
    params: idParamSchema
  },
  responses: {
    200: {
      description: "Voided challenge",
      content: {
        "application/json": {
          schema: z.object({
            challenge: challengeSchema.nullable()
          })
        }
      }
    },
    ...errorResponses
  }
});

app.openapi(voidChallengeRoute, async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  if (actor.userId !== "admin") {
    return errorJson(c, "Admin only.", 403);
  }
  const { id } = c.req.valid("param");
  const challenge = await getChallenge(c.env, id);
  if (!challenge) {
    return errorJson(c, "Challenge not found.", 404);
  }
  const matches = await listMatches(c.env, challenge.id);
  const db = createDb(c.env.DATABASE_URL);
  await db.transaction(async (tx) => {
    await applyWalletDelta(tx, challenge.creatorId, challenge.stakeCents, -challenge.stakeCents);
    for (const match of matches) {
      await applyWalletDelta(tx, match.matcherId, match.amountCents, -match.amountCents);
    }
    await tx.update(challenges).set({ status: "voided", updatedAt: new Date() }).where(eq(challenges.id, challenge.id));
  });
  return c.json({ challenge: await getChallenge(c.env, challenge.id) });
});

async function applySettlement(env: Env, challenge: Challenge, matches: ChallengeMatch[], outcome: Side): Promise<void> {
  const db = createDb(env.DATABASE_URL);
  const lockedExposure = new Map<string, number>();
  if (challenge.creatorSide === outcome) {
    lockedExposure.set(
      challenge.creatorId,
      matches.reduce((sum, match) => sum + match.amountCents, 0)
    );
  } else {
    for (const match of matches) {
      lockedExposure.set(match.matcherId, match.amountCents);
    }
  }

  await db.transaction(async (tx) => {
    for (const transfer of settleChallenge({ challenge, matches, outcome })) {
      if (transfer.type === "unlock") {
        await applyWalletDelta(tx, transfer.userId, transfer.amountCents, -transfer.amountCents);
      } else if (transfer.type === "settlement_win") {
        const lockedStake = lockedExposure.get(transfer.userId) ?? 0;
        await applyWalletDelta(tx, transfer.userId, transfer.amountCents, -lockedStake);
      } else if (transfer.type === "settlement_loss") {
        await applyWalletDelta(tx, transfer.userId, 0, -transfer.amountCents);
      }

      await tx.insert(ledgerEntries).values({
        id: newId("led"),
        userId: transfer.userId,
        type: transfer.type,
        amountCents: transfer.amountCents,
        challengeId: challenge.id,
        idempotencyKey: `settle:${challenge.id}:${transfer.userId}:${transfer.type}:${newId("idem")}`,
        description: transfer.description
      });
    }

    await tx.update(challengeMatches).set({ status: "settled" }).where(eq(challengeMatches.challengeId, challenge.id));
    await tx
      .update(challenges)
      .set({ status: "final_resolved", provisionalOutcome: outcome, updatedAt: new Date() })
      .where(eq(challenges.id, challenge.id));
  });
}

export class ChallengeObject {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as { challengeId: string; matcherId: string; amountCents: number };
    const challenge = await getChallenge(this.env, body.challengeId);
    if (!challenge) {
      return json({ error: "Challenge not found." }, { status: 404 });
    }

    validateMatchAmount(challenge, body.amountCents);
    const matchId = newId("mat");
    const side = oppositeSide(challenge.creatorSide);

    await lockFunds({
      env: this.env,
      userId: body.matcherId,
      amountCents: body.amountCents,
      type: "match_lock",
      challengeId: challenge.id,
      matchId,
      description: "Lock matcher challenge stake",
      idempotencyKey: `challenge-match:${matchId}`
    });

    const db = createDb(this.env.DATABASE_URL);
    await db.transaction(async (tx) => {
      const current = await tx.select().from(challenges).where(eq(challenges.id, challenge.id)).for("update").limit(1);
      if (!current[0]) {
        throw new Error("Challenge not found.");
      }

      await tx.insert(challengeMatches).values({
        id: matchId,
        challengeId: challenge.id,
        matcherId: body.matcherId,
        amountCents: body.amountCents,
        side
      });
      await tx
        .update(challenges)
        .set({
          matchedCents: current[0].matchedCents + body.amountCents,
          updatedAt: new Date()
        })
        .where(eq(challenges.id, challenge.id));
    });

    return json({ challenge: await getChallenge(this.env, challenge.id), match: { id: matchId, amountCents: body.amountCents, side } }, { status: 201 });
  }
}

export default {
  fetch: app.fetch
};
