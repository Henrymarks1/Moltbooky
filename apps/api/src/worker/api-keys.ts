import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { DEFAULT_AGENT_POLICY, createApiKeySecret, hashApiKey } from "@moltbooky/core/domain/apiKeys";
import { and, apiKeys, createDb, eq } from "@moltbooky/db";
import { actorFromRequest, newId } from "./db";
import { centsSchema, errorResponses, idParamSchema } from "./routes.shared";

const createApiKeyRequestSchema = z.object({
  name: z.string().optional()
});

export function registerApiKeyRoutes(app: OpenAPIHono<{ Bindings: Env }>): void {
  const createApiKeyRoute = createRoute({
    method: "post",
    path: "/api/api-keys",
    request: {
      body: {
        required: false,
        content: { "application/json": { schema: createApiKeyRequestSchema } }
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
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "API key revoked",
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }
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
}
