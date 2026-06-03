import type { ResolutionOutcome } from "@moltbooky/core/domain/types";
import { and, challenges, createDb, eq } from "@moltbooky/db";
import { runAiResolver } from "./agent";
import { appendResolutionEvent } from "./events";
import { loadPipedreamResolutionTools } from "./pipedream";
import type { ResolveRequest, ResolverExecutionContext, ResolverResult } from "./types";

export async function resolveChallenge(env: Env, request: ResolveRequest, ctx: ResolverExecutionContext): Promise<ResolverResult> {
  const db = createDb(env.DATABASE_URL);
  const { challengeId } = request;
  const emit = (kind: Parameters<typeof appendResolutionEvent>[1], title: string, body?: string | null, metadata: Record<string, unknown> = {}) =>
    appendResolutionEvent(request, kind, title, body, metadata);

  await db
    .update(challenges)
    .set({
      status: "resolving",
      updatedAt: new Date()
    })
    .where(and(eq(challenges.id, challengeId), eq(challenges.status, "open")));

  const rows = await db
    .select({
      creatorId: challenges.creatorId,
      stakeCents: challenges.stakeCents,
      status: challenges.status,
      provisionalOutcome: challenges.provisionalOutcome,
      claim: challenges.claim,
      resolutionCriteria: challenges.resolutionCriteria,
      resolutionTool: challenges.resolutionTool,
      pipedreamConnectionIds: challenges.pipedreamConnectionIds
    })
    .from(challenges)
    .where(eq(challenges.id, challengeId))
    .limit(1);
  const challenge = rows[0];

  if (!challenge) {
    throw new Error("Challenge not found.");
  }

  if (challenge.status === "voided" || challenge.status === "final_resolved") {
    return {
      outcome: (challenge.provisionalOutcome as ResolutionOutcome | null) ?? "UNRESOLVED",
      confidence: 0,
      sourceUrls: [],
      shortRationale: "Challenge is already closed."
    };
  }

  if (challenge.status === "provisional_resolved" && challenge.provisionalOutcome === "UNRESOLVED") {
    return {
      outcome: "UNRESOLVED",
      confidence: 0,
      sourceUrls: [],
      shortRationale: "Challenge was already marked unresolved."
    };
  }

  const exaQuery = `${request.challenge.claim}\nResolution criteria: ${request.challenge.resolutionCriteria}`;
  const resolutionTools = await loadPipedreamResolutionTools(env, challenge.creatorId, challenge.pipedreamConnectionIds ?? [], challenge.resolutionTool);
  return runAiResolver(env, ctx, request, emit, exaQuery, resolutionTools, challenge.creatorId);
}
