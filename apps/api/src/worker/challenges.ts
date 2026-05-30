import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { availableToMatch, validateChallengeInput, validateMatchAmount } from "@moltbooky/core/domain/challenge";
import { creditsToCents } from "@moltbooky/core/domain/money";
import { and, challengeMatches, challenges, createDb, desc, eq, ledgerEntries } from "@moltbooky/db";
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
  currentActor,
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

const challengeDraftDataSchema = z.object({
  claim: z.string().optional(),
  resolutionCriteria: z.string().optional(),
  creatorSide: sideSchema.optional(),
  visibility: challengeVisibilitySchema.optional(),
  stakeCredits: z.string().optional(),
  expiresAt: z.string().optional(),
  pipedreamConnectionIds: pipedreamConnectionIdsSchema.optional()
});
const saveChallengeDraftRequestSchema = z.object({ draft: challengeDraftDataSchema });
const challengeDraftResponseSchema = z.object({ id: z.string(), draft: challengeDraftDataSchema });

const createMatchRequestSchema = z
  .object({
    amountCredits: creditValueSchema.optional(),
    amountDollars: creditValueSchema.optional(),
    amountCents: betaStakeCentsSchema.optional()
  })
  .refine((value) => value.amountCredits !== undefined || value.amountDollars !== undefined || value.amountCents !== undefined, {
    message: "amountCredits or amountCents is required."
  });

export function registerChallengeRoutes(app: OpenAPIHono<{ Bindings: Env }>): void {
  const getChallengeDraftRoute = createRoute({
    method: "get",
    path: "/api/challenges/draft",
    responses: {
      200: {
        description: "Current user's challenge draft",
        content: { "application/json": { schema: z.object({ challenge: challengeDraftResponseSchema.nullable() }) } }
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
    request: { body: { content: { "application/json": { schema: saveChallengeDraftRequestSchema } } } },
    responses: {
      200: {
        description: "Saved challenge draft",
        content: { "application/json": { schema: z.object({ challenge: challengeDraftResponseSchema }) } }
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
    const stakeCents = body.draft.stakeCredits && /^\\d+(\\.\\d{1,2})?$/.test(body.draft.stakeCredits) ? creditsToCents(body.draft.stakeCredits) : 0;
    const draft = { ...body.draft, pipedreamConnectionIds };

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
        content: { "application/json": { schema: z.object({ deleted: z.boolean() }) } }
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
      await db.insert(challenges).values({ id: challengeId, creatorId: actor.userId, ...challengeValues });
    }

    return c.json({ challenge: await getChallenge(c.env, challengeId) }, 201);
  });

  const getChallengeRoute = createRoute({
    method: "get",
    path: "/api/challenges/{id}",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Challenge detail",
        content: { "application/json": { schema: z.object({ challenge: challengeSchema, matches: z.array(challengeMatchSchema), resolutionRuns: z.array(resolutionRunSchema), availableToMatchCents: centsSchema }) } }
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
