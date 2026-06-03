import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { availableToMatch, settleChallenge, validateChallengeInput, validateMatchAmount } from "@moltbooky/core/domain/challenge";
import { creditsToCents } from "@moltbooky/core/domain/money";
import type { Challenge, ChallengeMatch, ResolutionEvent, ResolutionOutcome, Side } from "@moltbooky/core/domain/types";
import { challengeMatches, challenges, createDb, eq, ledgerEntries, pipedreamConnections, resolutionRuns } from "@moltbooky/db";
import {
  actorFromRequest,
  getChallenge,
  listResolutionEvents,
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
  resolutionEventSchema,
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

const finalizeResolutionRequestSchema = z.object({
  runId: z.string().min(1),
  resolution: z.enum(["YES", "NO", "UNKNOWN"]),
  explanation: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).optional(),
  sourceUrls: z.array(z.string().url()).default([])
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

function challengeObject(env: Env, challengeId: string): DurableObjectStub {
  const durableId = env.CHALLENGE_OBJECT.idFromName(challengeId);
  return env.CHALLENGE_OBJECT.get(durableId);
}

async function initializeChallengeObject(env: Env, challenge: Challenge): Promise<void> {
  const response = await challengeObject(env, challenge.id).fetch(
    new Request("https://challenge-object/initialize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge })
    })
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "Could not initialize challenge object." }))) as { error?: string };
    throw new Error(body.error ?? "Could not initialize challenge object.");
  }
}

async function challengeObjectSnapshot(env: Env, challengeId: string): Promise<{ resolutionEvents: ResolutionEvent[]; currentRunId: string | null }> {
  const response = await challengeObject(env, challengeId).fetch(new Request(`https://challenge-object/snapshot?challengeId=${encodeURIComponent(challengeId)}`));
  if (!response.ok) {
    return { resolutionEvents: await listResolutionEvents(env, challengeId), currentRunId: null };
  }
  const body = (await response.json().catch(() => ({}))) as { resolutionEvents?: ResolutionEvent[]; currentRunId?: string | null };
  return {
    resolutionEvents: body.resolutionEvents ?? [],
    currentRunId: body.currentRunId ?? null
  };
}

function isInternalResolverRequest(request: Request, env: Env): boolean {
  const token = env.RESOLVER_TEST_TOKEN?.trim();
  const bearerToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return Boolean(token && bearerToken === token);
}

function toSettlementChallenge(row: typeof challenges.$inferSelect): Challenge {
  return {
    id: row.id,
    creatorId: row.creatorId,
    creatorName: row.creatorId,
    claim: row.claim,
    resolutionCriteria: row.resolutionCriteria,
    resolutionTool: null,
    pipedreamConnectionIds: row.pipedreamConnectionIds ?? [],
    creatorSide: row.creatorSide as Side,
    visibility: row.visibility as Challenge["visibility"],
    stakeCents: row.stakeCents,
    matchedCents: row.matchedCents,
    status: row.status as Challenge["status"],
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
    disputeDeadlineAt: row.disputeDeadlineAt instanceof Date ? row.disputeDeadlineAt.toISOString() : row.disputeDeadlineAt,
    provisionalOutcome: row.provisionalOutcome as ResolutionOutcome | null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt
  };
}

function toSettlementMatch(row: typeof challengeMatches.$inferSelect): ChallengeMatch {
  return {
    id: row.id,
    challengeId: row.challengeId,
    matcherId: row.matcherId,
    matcherName: row.matcherId,
    amountCents: row.amountCents,
    side: row.side as Side,
    status: row.status as ChallengeMatch["status"],
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt
  };
}

async function appendInternalResolverEvent(env: Env, event: Omit<ResolutionEvent, "id" | "createdAt">): Promise<void> {
  const token = env.RESOLVER_TEST_TOKEN?.trim();
  if (!token) {
    return;
  }
  await challengeObject(env, event.challengeId).fetch(
    new Request("https://challenge-object/resolver-event", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        ...event,
        id: newId("rev"),
        createdAt: new Date().toISOString()
      })
    })
  );
}

async function finalizeUnknownResolution(tx: any, challenge: Challenge, matches: ChallengeMatch[]): Promise<void> {
  if (challenge.stakeCents > 0) {
    await applyCreditDelta(tx, challenge.creatorId, challenge.stakeCents, -challenge.stakeCents);
    await tx
      .insert(ledgerEntries)
      .values({
        id: newId("led"),
        userId: challenge.creatorId,
        type: "unlock",
        amountCents: challenge.stakeCents,
        challengeId: challenge.id,
        idempotencyKey: `resolve:${challenge.id}:unknown:creator`,
        description: "Refund unresolved challenge stake"
      })
      .onConflictDoNothing();
  }

  for (const match of matches) {
    await applyCreditDelta(tx, match.matcherId, match.amountCents, -match.amountCents);
    await tx
      .insert(ledgerEntries)
      .values({
        id: newId("led"),
        userId: match.matcherId,
        type: "unlock",
        amountCents: match.amountCents,
        challengeId: challenge.id,
        matchId: match.id,
        idempotencyKey: `resolve:${challenge.id}:unknown:match:${match.id}`,
        description: "Refund unresolved match stake"
      })
      .onConflictDoNothing();
  }

  await tx.update(challengeMatches).set({ status: "cancelled" }).where(eq(challengeMatches.challengeId, challenge.id));
  await tx
    .update(challenges)
    .set({
      status: "voided",
      provisionalOutcome: "UNRESOLVED",
      disputeDeadlineAt: null,
      updatedAt: new Date()
    })
    .where(eq(challenges.id, challenge.id));
}

async function finalizeResolvedChallenge(tx: any, challenge: Challenge, matches: ChallengeMatch[], outcome: Side): Promise<void> {
  const lockedExposure = new Map<string, number>();
  if (challenge.creatorSide === outcome) {
    lockedExposure.set(
      challenge.creatorId,
      matches.reduce((sum, match) => sum + match.amountCents, 0)
    );
  } else {
    for (const match of matches) {
      lockedExposure.set(match.matcherId, (lockedExposure.get(match.matcherId) ?? 0) + match.amountCents);
    }
  }

  for (const [index, transfer] of settleChallenge({ challenge, matches, outcome }).entries()) {
    if (transfer.type === "unlock") {
      await applyCreditDelta(tx, transfer.userId, transfer.amountCents, -transfer.amountCents);
    } else if (transfer.type === "settlement_win") {
      const lockedStake = lockedExposure.get(transfer.userId) ?? 0;
      await applyCreditDelta(tx, transfer.userId, transfer.amountCents, -lockedStake);
    } else if (transfer.type === "settlement_loss") {
      await applyCreditDelta(tx, transfer.userId, 0, -transfer.amountCents);
    }

    await tx
      .insert(ledgerEntries)
      .values({
        id: newId("led"),
        userId: transfer.userId,
        type: transfer.type,
        amountCents: transfer.amountCents,
        challengeId: challenge.id,
        idempotencyKey: `resolve:${challenge.id}:${outcome}:${index}:${transfer.userId}:${transfer.type}`,
        description: transfer.description
      })
      .onConflictDoNothing();
  }

  await tx.update(challengeMatches).set({ status: "settled" }).where(eq(challengeMatches.challengeId, challenge.id));
  await tx
    .update(challenges)
    .set({ status: "final_resolved", provisionalOutcome: outcome, updatedAt: new Date() })
    .where(eq(challenges.id, challenge.id));
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
    const challenge = await getChallenge(c.env, challengeId);
    if (challenge) {
      await initializeChallengeObject(c.env, challenge);
    }

    return c.json({ challenge }, 201);
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
              resolutionEvents: z.array(resolutionEventSchema),
              resolutionRuns: z.array(resolutionRunSchema),
              currentRunId: z.string().nullable(),
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
    const snapshot = await challengeObjectSnapshot(c.env, challenge.id);
    return c.json({
      challenge,
      matches: await listMatches(c.env, challenge.id),
      resolutionEvents: snapshot.resolutionEvents,
      resolutionRuns: await listResolutionRuns(c.env, challenge.id),
      currentRunId: snapshot.currentRunId,
      availableToMatchCents: availableToMatch(challenge),
      resolverConnections: await listChallengeResolverConnections(c.env, challenge.creatorId, challenge.pipedreamConnectionIds)
    });
  });

  app.post("/api/challenges/:id/resolution-stream", async (c) => {
    const id = c.req.param("id");
    return challengeObject(c.env, id).fetch(
      new Request("https://challenge-object/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: id })
      })
    ) as any;
  });

  app.post("/api/internal/challenges/:id/resolver-events", async (c) => {
    if (!isInternalResolverRequest(c.req.raw, c.env)) {
      return errorJson(c, "Resolver event access is not allowed.", 403);
    }

    const id = c.req.param("id");
    return challengeObject(c.env, id).fetch(
      new Request("https://challenge-object/resolver-event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${c.env.RESOLVER_TEST_TOKEN?.trim()}`
        },
        body: await c.req.text()
      })
    ) as any;
  });

  app.post("/api/internal/challenges/:id/finalize-resolution", async (c) => {
    if (!isInternalResolverRequest(c.req.raw, c.env)) {
      return errorJson(c, "Resolver finalization access is not allowed.", 403);
    }

    const id = c.req.param("id");
    const parsed = finalizeResolutionRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorJson(c, "Invalid resolver finalization payload.", 400);
    }

    const body = parsed.data;
    const db = createDb(c.env.DATABASE_URL);
    const outcome: ResolutionOutcome = body.resolution === "UNKNOWN" ? "UNRESOLVED" : body.resolution;
    const snapshot = await challengeObjectSnapshot(c.env, id);
    if (snapshot.currentRunId && snapshot.currentRunId !== body.runId) {
      return errorJson(c, "Resolver run is no longer current for this challenge.", 400);
    }
    let didFinalize = false;

    await db.transaction(async (tx) => {
      const currentRows = await tx.select().from(challenges).where(eq(challenges.id, id)).for("update").limit(1);
      const current = currentRows[0];
      if (!current) {
        throw new Error("Challenge not found.");
      }

      const challenge = toSettlementChallenge(current);
      if (challenge.status === "final_resolved" || challenge.status === "voided" || challenge.status === "cancelled") {
        return;
      }

      if (challenge.status !== "open" && challenge.status !== "resolving" && challenge.status !== "provisional_resolved") {
        throw new Error("Challenge is not eligible for resolver finalization.");
      }

      const matches = (await tx.select().from(challengeMatches).where(eq(challengeMatches.challengeId, id)).for("update")).map(toSettlementMatch);
      const exaQuery = `${challenge.claim}\nResolution criteria: ${challenge.resolutionCriteria}`;
      await tx
        .insert(resolutionRuns)
        .values({
          id: body.runId,
          challengeId: id,
          exaQuery,
          sourceUrls: JSON.stringify(body.sourceUrls),
          aiRationale: body.explanation,
          proposedOutcome: outcome,
          confidence: body.confidence ?? (outcome === "UNRESOLVED" ? 0 : 1)
        })
        .onConflictDoNothing();

      if (outcome === "UNRESOLVED") {
        await finalizeUnknownResolution(tx, challenge, matches);
      } else {
        await finalizeResolvedChallenge(tx, challenge, matches, outcome);
      }
      didFinalize = true;
    });

    const finalizedChallenge = await getChallenge(c.env, id);
    if (!finalizedChallenge) {
      return errorJson(c, "Challenge not found.", 404);
    }

    if (didFinalize) {
      await appendInternalResolverEvent(c.env, {
        challengeId: id,
        runId: body.runId,
        kind: "run_finished",
        title: "Resolver finished",
        body: body.explanation,
        metadata: {
          outcome,
          confidence: body.confidence ?? (outcome === "UNRESOLVED" ? 0 : 1),
          sourceUrls: body.sourceUrls
        }
      });
    }

    return c.json({ ok: true, challenge: finalizedChallenge, result: { outcome, explanation: body.explanation, sourceUrls: body.sourceUrls } });
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

    return challengeObject(c.env, challenge.id).fetch(new Request("https://challenge-object/match", { method: "POST", body: JSON.stringify({ challengeId: challenge.id, matcherId: actor.userId, amountCents }) })) as any;
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
    if (challenge.status !== "open") {
      throw new Error("Only open challenges can release unmatched stake.");
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
      if (challenge.status !== "open") {
        throw new Error("Only open challenges can be deleted.");
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
