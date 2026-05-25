import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { availableToMatch, oppositeSide, settleChallenge, validateChallengeInput, validateMatchAmount } from "@moltbooky/core/domain/challenge";
import { DEFAULT_AGENT_POLICY, createApiKeySecret, hashApiKey } from "@moltbooky/core/domain/apiKeys";
import { dollarsToCents } from "@moltbooky/core/domain/money";
import type { Challenge, ChallengeMatch, Side } from "@moltbooky/core/domain/types";
import { and, apiKeys, challengeMatches, challenges, createDb, desc, eq, ledgerEntries, walletAccounts } from "@moltbooky/db";
import {
  actorFromRequest,
  ensureBetaUser,
  getChallenge,
  getWallet,
  json,
  listChallenges,
  listMatches,
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
const dateTimeSchema = z.string().datetime();
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
  creatorSide: sideSchema,
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

const dollarsSchema = z.union([z.string(), z.number()]);

const createChallengeRequestSchema = z
  .object({
    claim: z.string().min(1),
    resolutionCriteria: z.string().min(1),
    creatorSide: sideSchema,
    stakeDollars: dollarsSchema.optional(),
    stakeCents: betaStakeCentsSchema.optional(),
    expiresAt: requestDateTimeSchema
  })
  .refine((value) => value.stakeDollars !== undefined || value.stakeCents !== undefined, {
    message: "stakeDollars or stakeCents is required."
  });

const createMatchRequestSchema = z
  .object({
    amountDollars: dollarsSchema.optional(),
    amountCents: betaStakeCentsSchema.optional()
  })
  .refine((value) => value.amountDollars !== undefined || value.amountCents !== undefined, {
    message: "amountDollars or amountCents is required."
  });

const createApiKeyRequestSchema = z.object({
  name: z.string().optional()
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
- A creator posts a claim, resolution criteria, a creator side, stake, and expiry.
- Matchers can only take the opposite side.
- Odds are always 1:1.
- Only matched funds are at risk.
- Unmatched creator stake can be released while the challenge is open.
- Minimum stake is $5.
- Private beta max stake is $100.
- Platform fee is 2% of profit only.
- AI resolution is provisional and may be disputed.
- Payment and deposit flows may be disabled until legal, compliance, and payment approval are complete.

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
- \`GET /api/challenges/:id\` - read challenge details and matches.
- \`POST /api/challenges\` - create a challenge.
- \`POST /api/challenges/:id/matches\` - match the opposite side.
- \`POST /api/challenges/:id/cancel-unmatched\` - release unmatched creator stake.
- \`GET /api/wallet\` - read wallet balances.
- \`GET /api/ledger\` - read ledger entries.
- \`POST /api/api-keys\` - create an API key from a human session.
- \`DELETE /api/api-keys/:id\` - revoke an API key.
- \`GET /api/openapi.json\` - OpenAPI 3.1 API contract.

## Create Challenge Body

\`\`\`json
{
  "claim": "Will the stated event happen by the expiry?",
  "resolutionCriteria": "Resolve YES only if ...",
  "creatorSide": "YES",
  "stakeDollars": "25.00",
  "expiresAt": "2026-06-30T23:59:00.000Z"
}
\`\`\`

## Match Body

\`\`\`json
{
  "amountDollars": "10.00"
}
\`\`\`

## Response Handling

- If the API returns an auth error, ask the user to sign in or provide a valid scoped API key.
- If payment endpoints are disabled, do not retry as if it is a technical outage.
- If a challenge is closed, cancelled, voided, disputed, or resolved, do not attempt to match it.
- If a request fails validation, show the user the exact correction needed.
`;

function errorJson(c: any, message: string, status: 400 | 401 | 403 | 404) {
  return c.json({ error: message }, status) as any;
}

async function applyWalletDelta(tx: any, userId: string, availableDeltaCents: number, lockedDeltaCents: number): Promise<void> {
  const wallet = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for("update").limit(1);
  if (!wallet[0]) {
    throw new Error("Wallet not found.");
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
  const stakeCents = body.stakeCents ?? dollarsToCents(body.stakeDollars ?? "");
  const creatorSide = parseSide(body.creatorSide);
  const challengeId = newId("ch");

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

  const db = createDb(c.env.DATABASE_URL);
  await db.insert(challenges).values({
    id: challengeId,
    creatorId: actor.userId,
    claim: body.claim!.trim(),
    resolutionCriteria: body.resolutionCriteria!.trim(),
    creatorSide,
    stakeCents,
    status: "open",
    expiresAt: new Date(body.expiresAt!)
  });

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

  const amountCents = body.amountCents ?? dollarsToCents(body.amountDollars ?? "");
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

const getWalletRoute = createRoute({
  method: "get",
  path: "/api/wallet",
  responses: {
    200: {
      description: "Current wallet",
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
