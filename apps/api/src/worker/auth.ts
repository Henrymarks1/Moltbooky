import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb, schema } from "@moltbooky/db";

export function createAuth(env: Env) {
  return betterAuth({
    appName: "Moltbooky",
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET ?? "local-dev-secret-change-before-deploy",
    database: drizzleAdapter(createDb(env.DATABASE_URL), {
      provider: "pg",
      schema
    }),
    emailAndPassword: {
      enabled: true
    },
    trustedOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"]
  });
}

export async function getSessionUserId(env: Env, request: Request): Promise<string | null> {
  const session = await createAuth(env).api.getSession({
    headers: request.headers
  });
  return session?.user?.id ?? null;
}
