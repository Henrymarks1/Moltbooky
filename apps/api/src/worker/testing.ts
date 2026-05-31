import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { creditsToCents } from "@moltbooky/core/domain/money";
import { appUsers, createDb, eq, ledgerEntries } from "@moltbooky/db";
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

function resolverBaseUrl(env: Env): string {
  return (env.RESOLVER_URL?.trim() || "http://localhost:8788").replace(/\/+$/, "");
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
        description: "Triggered immediate resolver run",
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
    const actor = await testingActor(c.env, c.req.raw);
    if (!actor.allowed) {
      return errorJson(c, "Testing tools are not enabled for this account.", 403);
    }

    const { id } = c.req.valid("param");
    const challenge = await getChallenge(c.env, id);
    if (!challenge) {
      return errorJson(c, "Bet not found.", 404);
    }
    if (challenge.creatorId !== actor.userId) {
      return errorJson(c, "Testing resolver runs are only allowed for your own bets.", 403);
    }

    const headers: Record<string, string> = {};
    if (c.env.RESOLVER_TEST_TOKEN?.trim()) {
      headers.authorization = `Bearer ${c.env.RESOLVER_TEST_TOKEN.trim()}`;
    }

    const resolverResponse = await fetch(`${resolverBaseUrl(c.env)}/resolve/${encodeURIComponent(id)}`, {
      method: "POST",
      headers
    });
    const resolver = (await resolverResponse.json().catch(() => ({ error: "Resolver returned a non-JSON response." }))) as { error?: string };
    if (!resolverResponse.ok) {
      return c.json({ error: typeof resolver?.error === "string" ? resolver.error : "Resolver run failed.", resolver }, resolverResponse.status as any);
    }

    return c.json({
      challenge: await getChallenge(c.env, id),
      resolver
    });
  });
}
