import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { availableToMatch, validateChallengeInput, validateMatchAmount } from "@moltbooky/core/domain/challenge";
import { creditsToCents } from "@moltbooky/core/domain/money";
import { challengeMatches, challenges, createDb, eq, ledgerEntries, pipedreamConnections } from "@moltbooky/db";
import {
  actorFromRequest,
  getChallenge,
  listChallenges,
  listMatches,
  listResolutionRuns,
  listUserChallenges,
  listUserMatches,
  lockFunds,
  newId,
  parseSide,
  requireScope
} from "./db";
import {
  applyCreditDelta,
  betaStakeCentsSchema,
  centsSchema,
  challengeMatchSchema,
  challengeSchema,
  challengeVisibilitySchema,
  createdMatchSchema,
  creditValueSchema,
  errorJson,
  errorResponses,
  idParamSchema,
  pipedreamConnectionIdsSchema,
  requestDateTimeSchema,
  resolutionRunSchema,
  resolutionToolSchema,
  resolutionToolsSchema,
  sideSchema,
  validateUserPipedreamConnectionIds
} from "./routes.shared";

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

const createMatchRequestSchema = z
  .object({
    amountCredits: creditValueSchema.optional(),
    amountDollars: creditValueSchema.optional(),
    amountCents: betaStakeCentsSchema.optional()
  })
  .refine((value) => value.amountCredits !== undefined || value.amountDollars !== undefined || value.amountCents !== undefined, {
    message: "amountCredits or amountCents is required."
  });

const resolverConnectionSchema = z.object({
  id: z.string(),
  appSlug: z.string(),
  appName: z.string()
});

async function listChallengeResolverConnections(env: Env, creatorId: string, connectionIds: string[] = []) {
  if (connectionIds.length === 0) {
    return [];
  }
  const db = createDb(env.DATABASE_URL);
  const rows = await db
    .select({
      id: pipedreamConnections.id,
      appSlug: pipedreamConnections.appSlug,
      appName: pipedreamConnections.appName
    })
    .from(pipedreamConnections)
    .where(eq(pipedreamConnections.userId, creatorId));
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return connectionIds.map((connectionId) => rowsById.get(connectionId)).filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export function registerChallengeRoutes(app: OpenAPIHono<{ Bindings: Env }>): void {
  const listChallengesRoute = createRoute({
    method: "get",
    path: "/api/challenges",
    responses: {
      200: { description: "List recent challenges", content: { "application/json": { schema: z.object({ challenges: z.array(challengeSchema) }) } } },
      ...errorResponses
    }
  });

  app.openapi(listChallengesRoute, async (c) => c.json({ challenges: await listChallenges(c.env) }));

  const listMyChallengesRoute = createRoute({
    method: "get",
    path: "/api/my/challenges",
    responses: {
      200: {
        description: "List challenges created or matched by the current user",
        content: { "application/json": { schema: z.object({ challenges: z.array(challengeSchema), matches: z.array(challengeMatchSchema) }) } }
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
    request: { body: { content: { "application/json": { schema: createChallengeRequestSchema } } } },
    responses: {
      201: { description: "Created challenge", content: { "application/json": { schema: z.object({ challenge: challengeSchema.nullable() }) } } },
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

    await db.insert(challenges).values({ id: challengeId, creatorId: actor.userId, ...challengeValues });

    return c.json({ challenge: await getChallenge(c.env, challengeId) }, 201);
  });

  const getChallengeRoute = createRoute({
    method: "get",
    path: "/api/challenges/{id}",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Challenge detail",
        content: {
          "application/json": {
            schema: z.object({
              challenge: challengeSchema,
              matches: z.array(challengeMatchSchema),
              resolutionRuns: z.array(resolutionRunSchema),
              availableToMatchCents: centsSchema,
              resolverConnections: z.array(resolverConnectionSchema)
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
      availableToMatchCents: availableToMatch(challenge),
      resolverConnections: await listChallengeResolverConnections(c.env, challenge.creatorId, challenge.pipedreamConnectionIds)
    });
  });

  const createMatchRoute = createRoute({
    method: "post",
    path: "/api/challenges/{id}/matches",
    request: { params: idParamSchema, body: { content: { "application/json": { schema: createMatchRequestSchema } } } },
    responses: {
      201: { description: "Created match", content: { "application/json": { schema: z.object({ challenge: challengeSchema.nullable(), match: createdMatchSchema }) } } },
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
    return object.fetch(new Request("https://challenge-object/match", { method: "POST", body: JSON.stringify({ challengeId: challenge.id, matcherId: actor.userId, amountCents }) })) as any;
  });

  const cancelUnmatchedRoute = createRoute({
    method: "post",
    path: "/api/challenges/{id}/cancel-unmatched",
    request: { params: idParamSchema },
    responses: {
      200: { description: "Released unmatched creator stake", content: { "application/json": { schema: z.object({ challenge: challengeSchema, unlockedCents: centsSchema }) } } },
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
      await applyCreditDelta(tx, actor.userId, unmatched, -unmatched);
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
        .set({ stakeCents: challenge.matchedCents, status: challenge.matchedCents === 0 ? "cancelled" : challenge.status, updatedAt: new Date() })
        .where(eq(challenges.id, challenge.id));
    });

    return c.json({ challenge: await getChallenge(c.env, challenge.id), unlockedCents: unmatched });
  });

  const deleteChallengeRoute = createRoute({
    method: "delete",
    path: "/api/challenges/{id}",
    request: { params: idParamSchema },
    responses: {
      200: { description: "Deleted unmatched creator challenge", content: { "application/json": { schema: z.object({ deleted: z.boolean(), unlockedCents: centsSchema }) } } },
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
        await applyCreditDelta(tx, actor.userId, unlockedCents, -unlockedCents);
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
}
