import { resolveChallenge } from "./resolve";
import { resolveRequestSchema, type ResolveRequest, type ResolverExecutionContext } from "./types";

function isResolverRequestAllowed(request: Request, env: Env): boolean {
  const configuredToken = env.RESOLVER_TEST_TOKEN?.trim();
  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return Boolean(configuredToken && bearerToken === configuredToken);
}

export async function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return Response.json({ ok: true, name: "Moltbooky Resolver" });
  }

  if (request.method === "POST" && url.pathname === "/resolve") {
    if (!isResolverRequestAllowed(request, env)) {
      return Response.json({ error: "Resolver access is not allowed." }, { status: 403 });
    }
    const parsed = resolveRequestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ error: "Invalid resolver request." }, { status: 400 });
    }
    const result = await resolveChallenge(env, parsed.data as ResolveRequest, ctx as ResolverExecutionContext);
    return Response.json({ ok: true, challengeId: parsed.data.challengeId, runId: parsed.data.runId, finalized: result.finalized === true, result });
  }

  return Response.json({ error: "Not found." }, { status: 404 });
}
