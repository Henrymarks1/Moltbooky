import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { authAccount, authSession, authUser, authVerification, createDb } from "@moltbooky/db";

const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification
};

function isLocalAuthUrl(url: string | undefined): boolean {
  return !url || url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1");
}

function resolveAuthSecret(env: Env): string {
  if (env.BETTER_AUTH_SECRET) {
    return env.BETTER_AUTH_SECRET;
  }

  if (isLocalAuthUrl(env.BETTER_AUTH_URL)) {
    return "local-dev-secret-change-before-deploy";
  }

  throw new Error("BETTER_AUTH_SECRET is required outside local development.");
}

export function createAuth(env: Env) {
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  return betterAuth({
    appName: "Moltbooky",
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:5173",
    basePath: "/api/auth",
    secret: resolveAuthSecret(env),
    database: drizzleAdapter(createDb(env.DATABASE_URL), {
      provider: "pg",
      schema: authSchema
    }),
    emailAndPassword: {
      enabled: true
    },
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!
          }
        }
      : undefined,
    trustedOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"]
  });
}

export async function getSessionUserId(env: Env, request: Request): Promise<string | null> {
  const session = await createAuth(env).api.getSession({
    headers: request.headers
  });
  return session?.user?.id ?? null;
}
