import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { createDb, desc, eq, pipedreamConnections } from "@moltbooky/db";
import { newId } from "./db";
import { currentActor, errorResponses } from "./routes.shared";

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

function pipedreamEnabled(env: Env): boolean {
  return Boolean(env.PIPEDREAM_CLIENT_ID && env.PIPEDREAM_CLIENT_SECRET && env.PIPEDREAM_PROJECT_ID);
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

export function registerIntegrationRoutes(app: OpenAPIHono<{ Bindings: Env }>): void {
  const pipedreamConfigRoute = createRoute({
    method: "get",
    path: "/api/integrations/pipedream/config",
    responses: {
      200: {
        description: "Pipedream Connect configuration state",
        content: { "application/json": { schema: z.object({ enabled: z.boolean(), environment: z.string() }) } }
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
        content: { "application/json": { schema: z.object({ apps: z.array(pipedreamAppSchema) }) } }
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
      data?: Array<{ id?: string; name_slug?: string; name?: string; description?: string; img_src?: string; categories?: string[]; auth_type?: string }>;
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
        content: { "application/json": { schema: z.object({ connections: z.array(pipedreamConnectionSchema) }) } }
      },
      ...errorResponses
    }
  });

  app.openapi(listPipedreamConnectionsRoute, async (c) => {
    const actor = await currentActor(c.env, c.req.raw);
    const db = createDb(c.env.DATABASE_URL);
    const rows = await db.select().from(pipedreamConnections).where(eq(pipedreamConnections.userId, actor.userId)).orderBy(desc(pipedreamConnections.updatedAt));

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
    request: { body: { content: { "application/json": { schema: savePipedreamConnectionRequestSchema } } } },
    responses: {
      201: {
        description: "Saved Pipedream connection",
        content: { "application/json": { schema: z.object({ connection: pipedreamConnectionSchema }) } }
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
        content: { "application/json": { schema: pipedreamTokenResponseSchema } }
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
}
