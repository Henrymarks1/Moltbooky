import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createAuth } from "./auth";
import { registerAdminRoutes } from "./admin";
import { registerApiKeyRoutes } from "./api-keys";
import { registerChallengeRoutes } from "./challenges";
import { registerCreditRoutes } from "./credits";
import { json } from "./db";
import { registerIntegrationRoutes } from "./integrations";
import { registerPaymentsRoutes } from "./payments";
import { agentSkillMarkdown } from "./skill";

export { ChallengeObject } from "./challenge-object";

const app = new OpenAPIHono<{ Bindings: Env }>();

app.onError((error) => json({ error: error.message }, { status: 400 }));

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

registerPaymentsRoutes(app);
registerIntegrationRoutes(app);
registerChallengeRoutes(app);
registerCreditRoutes(app);
registerApiKeyRoutes(app);
registerAdminRoutes(app);

export default {
  fetch: app.fetch
};
