import type { ResolutionOutcome } from "@moltbooky/core/domain/types";
import { and, appUsers, challengeRequiredApps, challenges, createDb, eq } from "@moltbooky/db";
import { runAiResolver } from "./agent";
import { appendResolutionEvent } from "./events";
import { loadHeadToHeadResolutionTools, loadPipedreamResolutionTools } from "./pipedream";
import type { ResolverPipedreamTool, ResolveRequest, ResolverResult } from "./types";

export async function resolveChallenge(env: Env, request: ResolveRequest): Promise<ResolverResult> {
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
      pipedreamConnectionIds: challenges.pipedreamConnectionIds,
      kind: challenges.kind,
      invitedOpponentId: challenges.invitedOpponentId
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

  let resolutionTools: ResolverPipedreamTool[];
  let competitors: { creatorId: string; creatorName: string; opponentId: string; opponentName: string } | undefined;
  if (challenge.kind === "head_to_head" && challenge.invitedOpponentId) {
    // Head-to-head: pull each side's bound connections so the agent can compare both people.
    const requiredApps = await db.select().from(challengeRequiredApps).where(eq(challengeRequiredApps.challengeId, challengeId));
    const names = await db
      .select({ id: appUsers.id, displayName: appUsers.displayName })
      .from(appUsers)
      .where(and(eq(appUsers.id, challenge.creatorId)));
    const opponentNames = await db
      .select({ id: appUsers.id, displayName: appUsers.displayName })
      .from(appUsers)
      .where(eq(appUsers.id, challenge.invitedOpponentId));
    const creatorName = names[0]?.displayName ?? "Creator";
    const opponentName = opponentNames[0]?.displayName ?? "Opponent";
    competitors = { creatorId: challenge.creatorId, creatorName, opponentId: challenge.invitedOpponentId, opponentName };
    resolutionTools = await loadHeadToHeadResolutionTools(env, [
      {
        externalUserId: challenge.creatorId,
        label: `${creatorName} (creator)`,
        connectionIds: requiredApps.map((app) => app.creatorConnectionId).filter((id): id is string => Boolean(id))
      },
      {
        externalUserId: challenge.invitedOpponentId,
        label: `${opponentName} (opponent)`,
        connectionIds: requiredApps.map((app) => app.opponentConnectionId).filter((id): id is string => Boolean(id))
      }
    ]);
  } else {
    resolutionTools = await loadPipedreamResolutionTools(env, challenge.creatorId, challenge.pipedreamConnectionIds ?? [], challenge.resolutionTool);
  }

  return runAiResolver(env, request, emit, exaQuery, resolutionTools, challenge.kind === "head_to_head" ? "head_to_head" : "open_match", competitors);
}
