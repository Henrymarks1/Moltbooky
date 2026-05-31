import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { creditsToCents } from "@moltbooky/core/domain/money";
import { appUsers, challenges, createDb, eq, ledgerEntries } from "@moltbooky/db";
import { actorFromRequest, getChallenge, newId } from "./db";
import { applyCreditDelta, challengeSchema, errorJson, errorResponses, idParamSchema } from "./routes.shared";

const defaultTestingEmails = ["henryesmarks@gmail.com"];

const addTestingCreditsRequestSchema = z.object({
  amountCredits: z.union([z.string(), z.number()])
});

function testingEmailSet(env: Env): Set<string> {
  const configured = env.TESTING_MODE_EMAILS?.trim();
  const emails = configured ? configured.split(",") : defaultTestingEmails;
  return new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean));
}

async function testingActor(env: Env, request: Request): Promise<{ userId: string; email: string; allowed: boolean }> {
  const actor = await actorFromRequest(env, request);
  const db = createDb(env.DATABASE_URL);
  const rows = await db.select({ email: appUsers.email }).from(appUsers).where(eq(appUsers.id, actor.userId)).limit(1);
  const email = rows[0]?.email?.toLowerCase() ?? "";
  return {
    userId: actor.userId,
    email,
    allowed: testingEmailSet(env).has(email)
  };
}

async function assertTestingChallengeAccess(env: Env, request: Request, id: string): Promise<Response | { userId: string; runAt: Date }> {
  const actor = await testingActor(env, request);
  if (!actor.allowed) {
    return new Response(JSON.stringify({ error: "Testing tools are not enabled for this account." }), { status: 403, headers: { "content-type": "application/json" } });
  }

  const challenge = await getChallenge(env, id);
  if (!challenge) {
    return new Response(JSON.stringify({ error: "Bet not found." }), { status: 404, headers: { "content-type": "application/json" } });
  }
  if (challenge.creatorId !== actor.userId) {
    return new Response(JSON.stringify({ error: "Testing resolver runs are only allowed for your own bets." }), { status: 403, headers: { "content-type": "application/json" } });
  }

  const runAt = new Date(Date.now() + 2_000);
  if (challenge.status === "open") {
    await createDb(env.DATABASE_URL)
      .update(challenges)
      .set({ expiresAt: runAt, updatedAt: new Date() })
      .where(eq(challenges.id, id));
  }

  return { userId: actor.userId, runAt };
}

async function scheduleChallengeResolutionAlarm(env: Env, challengeId: string, runAt: Date): Promise<void> {
  const durableId = env.CHALLENGE_OBJECT.idFromName(challengeId);
  const object = env.CHALLENGE_OBJECT.get(durableId);
  const response = await object.fetch(
    new Request("https://challenge-object/schedule-resolution", {
      method: "POST",
      body: JSON.stringify({ challengeId, runAt: runAt.toISOString() })
    })
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "Could not schedule resolver alarm." }))) as { error?: string };
    throw new Error(body.error ?? "Could not schedule resolver alarm.");
  }
}

export function registerTestingRoutes(app: OpenAPIHono<{ Bindings: Env }>): void {
  const getTestingConfigRoute = createRoute({
    method: "get",
    path: "/api/testing/config",
    responses: {
      200: {
        description: "Testing capability for the current user",
        content: { "application/json": { schema: z.object({ enabled: z.boolean(), email: z.string().optional() }) } }
      },
      ...errorResponses
    }
  });

  app.openapi(getTestingConfigRoute, async (c) => {
    const actor = await testingActor(c.env, c.req.raw);
    return c.json({ enabled: actor.allowed, email: actor.email || undefined });
  });

  const addTestingCreditsRoute = createRoute({
    method: "post",
    path: "/api/testing/credits",
    request: {
      body: { content: { "application/json": { schema: addTestingCreditsRequestSchema } } }
    },
    responses: {
      200: {
        description: "Added testing credits",
        content: {
          "application/json": {
            schema: z.object({
              amountCents: z.number().int().positive()
            })
          }
        }
      },
      ...errorResponses
    }
  });

  app.openapi(addTestingCreditsRoute, async (c) => {
    const actor = await testingActor(c.env, c.req.raw);
    if (!actor.allowed) {
      return errorJson(c, "Testing tools are not enabled for this account.", 403);
    }

    const body = c.req.valid("json");
    const amountCents = creditsToCents(body.amountCredits);
    if (amountCents < 100 || amountCents > 100_000) {
      return errorJson(c, "Testing credit amount must be between 1 and 1000 credits.", 400);
    }

    const db = createDb(c.env.DATABASE_URL);
    await db.transaction(async (tx) => {
      await applyCreditDelta(tx, actor.userId, amountCents, 0);
      await tx.insert(ledgerEntries).values({
        id: newId("led"),
        userId: actor.userId,
        type: "credit_purchase",
        amountCents,
        idempotencyKey: `testing-credit:${actor.userId}:${newId("idem")}`,
        description: "Add testing credits"
      });
    });

    return c.json({ amountCents });
  });

  const resolveTestingChallengeRoute = createRoute({
    method: "post",
    path: "/api/testing/challenges/{id}/resolve",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Scheduled an immediate testing resolver alarm",
        content: {
          "application/json": {
            schema: z.object({
              challenge: challengeSchema.nullable(),
              resolver: z.unknown()
            })
          }
        }
      },
      ...errorResponses
    }
  });

  app.openapi(resolveTestingChallengeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const access = await assertTestingChallengeAccess(c.env, c.req.raw, id);
    if (access instanceof Response) {
      const error = (await access.json().catch(() => ({ error: "Testing resolver run failed." }))) as { error?: string };
      return errorJson(c, error.error ?? "Testing resolver run failed.", access.status as any);
    }

    await scheduleChallengeResolutionAlarm(c.env, id, access.runAt);

    return c.json({
      challenge: await getChallenge(c.env, id),
      resolver: { scheduled: true, runAt: access.runAt.toISOString() }
    });
  });
}
