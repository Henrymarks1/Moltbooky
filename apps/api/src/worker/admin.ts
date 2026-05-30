import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { settleChallenge } from "@moltbooky/core/domain/challenge";
import type { Challenge, ChallengeMatch, Side } from "@moltbooky/core/domain/types";
import { challengeMatches, challenges, createDb, eq, ledgerEntries } from "@moltbooky/db";
import { actorFromRequest, getChallenge, listMatches, newId, parseSide } from "./db";
import { applyCreditDelta, challengeSchema, errorJson, errorResponses, idParamSchema, sideSchema } from "./routes.shared";

const finalizeChallengeRequestSchema = z.object({
  outcome: sideSchema
});

export function registerAdminRoutes(app: OpenAPIHono<{ Bindings: Env }>): void {
  const finalizeChallengeRoute = createRoute({
    method: "post",
    path: "/api/admin/challenges/{id}/finalize",
    request: {
      params: idParamSchema,
      body: { content: { "application/json": { schema: finalizeChallengeRequestSchema } } }
    },
    responses: {
      200: {
        description: "Finalized challenge",
        content: { "application/json": { schema: z.object({ challenge: challengeSchema.nullable() }) } }
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
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Voided challenge",
        content: { "application/json": { schema: z.object({ challenge: challengeSchema.nullable() }) } }
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
      await applyCreditDelta(tx, challenge.creatorId, challenge.stakeCents, -challenge.stakeCents);
      for (const match of matches) {
        await applyCreditDelta(tx, match.matcherId, match.amountCents, -match.amountCents);
      }
      await tx.update(challenges).set({ status: "voided", updatedAt: new Date() }).where(eq(challenges.id, challenge.id));
    });
    return c.json({ challenge: await getChallenge(c.env, challenge.id) });
  });
}

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
        await applyCreditDelta(tx, transfer.userId, transfer.amountCents, -transfer.amountCents);
      } else if (transfer.type === "settlement_win") {
        const lockedStake = lockedExposure.get(transfer.userId) ?? 0;
        await applyCreditDelta(tx, transfer.userId, transfer.amountCents, -lockedStake);
      } else if (transfer.type === "settlement_loss") {
        await applyCreditDelta(tx, transfer.userId, 0, -transfer.amountCents);
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
