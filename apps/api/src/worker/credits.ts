import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { createDb, desc, eq, ledgerEntries } from "@moltbooky/db";
import { actorFromRequest, getCreditAccount, requireScope } from "./db";
import { creditAccountSchema, errorResponses, ledgerEntrySchema } from "./routes.shared";

export function registerCreditRoutes(app: OpenAPIHono<{ Bindings: Env }>): void {
  const getCreditAccountRoute = createRoute({
    method: "get",
    path: "/api/credits",
    responses: {
      200: {
        description: "Current platform credit account",
        content: { "application/json": { schema: z.object({ creditAccount: creditAccountSchema }) } }
      },
      ...errorResponses
    }
  });

  app.openapi(getCreditAccountRoute, async (c) => {
    const actor = await actorFromRequest(c.env, c.req.raw);
    requireScope(actor, "credits:read");
    return c.json({ creditAccount: await getCreditAccount(c.env, actor.userId) });
  });

  const getLedgerRoute = createRoute({
    method: "get",
    path: "/api/ledger",
    responses: {
      200: {
        description: "Recent ledger entries",
        content: { "application/json": { schema: z.object({ ledger: z.array(ledgerEntrySchema) }) } }
      },
      ...errorResponses
    }
  });

  app.openapi(getLedgerRoute, async (c) => {
    const actor = await actorFromRequest(c.env, c.req.raw);
    requireScope(actor, "credits:read");
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
}
