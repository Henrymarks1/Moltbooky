import { and, apiKeys, appUsers, authUser, challengeMatches, challengeRequiredApps, challenges, createDb, desc, eq, gte, isNull, ledgerEntries, resolutionEvents, resolutionRuns, creditAccounts } from "@moltbooky/db";
import type { Challenge, ChallengeMatch, RequiredApp, ResolutionEvent, ResolutionRun, ResolutionTool, Side, CreditAccount } from "@moltbooky/core/domain/types";
import { getSessionUserId } from "./auth";

function serializeTimestamp(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function toChallenge(row: typeof challenges.$inferSelect, creator?: { displayName?: string | null; authName?: string | null }): Challenge {
  let resolutionTool: Challenge["resolutionTool"] = null;
  if (row.resolutionTool) {
    try {
      const parsed = JSON.parse(row.resolutionTool) as ResolutionTool | ResolutionTool[];
      resolutionTool = Array.isArray(parsed)
        ? parsed.filter((tool): tool is ResolutionTool => tool?.type === "pipedream_action")
        : parsed?.type === "pipedream_action"
          ? parsed
          : null;
    } catch {
      resolutionTool = null;
    }
  }

  return {
    id: row.id,
    creatorId: row.creatorId,
    creatorName: resolveDisplayName({ matcherId: row.creatorId, displayName: creator?.displayName, authName: creator?.authName }),
    claim: row.claim,
    resolutionCriteria: row.resolutionCriteria,
    resolutionTool,
    pipedreamConnectionIds: row.pipedreamConnectionIds ?? [],
    creatorSide: row.creatorSide as Challenge["creatorSide"],
    kind: (row.kind ?? "open_match") as Challenge["kind"],
    invitedOpponentEmail: row.invitedOpponentEmail ?? null,
    invitedOpponentId: row.invitedOpponentId ?? null,
    acceptedAt: serializeTimestamp(row.acceptedAt),
    visibility: row.visibility as Challenge["visibility"],
    stakeCents: row.stakeCents,
    matchedCents: row.matchedCents,
    status: row.status as Challenge["status"],
    expiresAt: serializeTimestamp(row.expiresAt)!,
    disputeDeadlineAt: serializeTimestamp(row.disputeDeadlineAt),
    provisionalOutcome: row.provisionalOutcome as Challenge["provisionalOutcome"],
    createdAt: serializeTimestamp(row.createdAt)!
  };
}

function resolveDisplayName(params: { matcherId: string; displayName?: string | null; authName?: string | null }): string {
  const { matcherId, displayName, authName } = params;
  const normalizedDisplayName = displayName?.trim();
  if (normalizedDisplayName && normalizedDisplayName !== matcherId) {
    return normalizedDisplayName;
  }

  return authName?.trim() || normalizedDisplayName || matcherId;
}

function toChallengeMatch(
  row: typeof challengeMatches.$inferSelect,
  matcher?: { displayName?: string | null; authName?: string | null }
): ChallengeMatch {
  return {
    id: row.id,
    challengeId: row.challengeId,
    matcherId: row.matcherId,
    matcherName: resolveDisplayName({ matcherId: row.matcherId, displayName: matcher?.displayName, authName: matcher?.authName }),
    amountCents: row.amountCents,
    side: row.side as ChallengeMatch["side"],
    status: row.status as ChallengeMatch["status"],
    createdAt: serializeTimestamp(row.createdAt)!
  };
}

function toResolutionRun(row: typeof resolutionRuns.$inferSelect): ResolutionRun {
  let sourceUrls: string[];
  try {
    const parsed = JSON.parse(row.sourceUrls) as unknown;
    sourceUrls = Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === "string") : [];
  } catch {
    sourceUrls = [];
  }

  return {
    id: row.id,
    challengeId: row.challengeId,
    exaQuery: row.exaQuery,
    sourceUrls,
    aiRationale: row.aiRationale,
    proposedOutcome: row.proposedOutcome as ResolutionRun["proposedOutcome"],
    confidence: row.confidence,
    createdAt: serializeTimestamp(row.createdAt)!
  };
}

function toResolutionEvent(row: typeof resolutionEvents.$inferSelect): ResolutionEvent {
  let metadata: Record<string, unknown>;
  try {
    const parsed = JSON.parse(row.metadata) as unknown;
    metadata = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    metadata = {};
  }

  return {
    id: row.id,
    challengeId: row.challengeId,
    runId: row.runId,
    kind: row.kind as ResolutionEvent["kind"],
    title: row.title,
    body: row.body,
    metadata,
    createdAt: serializeTimestamp(row.createdAt)!
  };
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function ensureBetaUser(env: Env, userId: string): Promise<void> {
  const db = createDb(env.DATABASE_URL);
  const existing = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.id, userId)).limit(1);
  if (existing.length > 0) {
    return;
  }

  const authRecord = await db
    .select({
      name: authUser.name,
      email: authUser.email
    })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1);

  await db.transaction(async (tx) => {
    await tx
      .insert(appUsers)
      .values({
        id: userId,
        email: authRecord[0]?.email ?? `${userId}@moltbooky.local`,
        displayName: authRecord[0]?.name?.trim() || userId,
        betaStatus: "invited"
      })
      .onConflictDoNothing();

    await tx
      .insert(creditAccounts)
      .values({
        userId
      })
      .onConflictDoNothing();
  });
}

export async function getCreditAccount(env: Env, userId: string): Promise<CreditAccount> {
  const db = createDb(env.DATABASE_URL);
  const result = await db
    .select({
      userId: creditAccounts.userId,
      availableCents: creditAccounts.availableCents,
      lockedCents: creditAccounts.lockedCents
    })
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, userId))
    .limit(1);

  if (!result[0]) {
    throw new Error("Credit account not found.");
  }
  return result[0];
}

export async function lockFunds(params: {
  env: Env;
  userId: string;
  amountCents: number;
  type: "lock" | "match_lock";
  challengeId: string;
  matchId?: string;
  description: string;
  idempotencyKey: string;
}): Promise<void> {
  const { env, userId, amountCents, type, challengeId, matchId, description, idempotencyKey } = params;
  const db = createDb(env.DATABASE_URL);
  await db.transaction(async (tx) => {
    const creditAccount = await tx
      .select()
      .from(creditAccounts)
      .where(and(eq(creditAccounts.userId, userId), gte(creditAccounts.availableCents, amountCents)))
      .for("update")
      .limit(1);

    if (!creditAccount[0]) {
      throw new Error("Not enough available credits.");
    }

    await tx
      .update(creditAccounts)
      .set({
        availableCents: creditAccount[0].availableCents - amountCents,
        lockedCents: creditAccount[0].lockedCents + amountCents,
        updatedAt: new Date()
      })
      .where(eq(creditAccounts.userId, userId));

    await tx.insert(ledgerEntries).values({
      id: newId("led"),
      userId,
      type,
      amountCents,
      challengeId,
      matchId: matchId ?? null,
      idempotencyKey,
      description
    });
  });
}

export async function listChallenges(env: Env): Promise<Challenge[]> {
  const db = createDb(env.DATABASE_URL);
  const result = await db
    .select()
    .from(challenges)
    .where(eq(challenges.visibility, "public"))
    .orderBy(desc(challenges.createdAt))
    .limit(100);
  return result.map((row) => toChallenge(row));
}

export async function listUserChallenges(env: Env, userId: string): Promise<Challenge[]> {
  const db = createDb(env.DATABASE_URL);
  const createdRows = await db
    .select()
    .from(challenges)
    .where(eq(challenges.creatorId, userId))
    .orderBy(desc(challenges.createdAt))
    .limit(100);
  const matchedRows = await db
    .select({ challenge: challenges })
    .from(challengeMatches)
    .innerJoin(challenges, eq(challengeMatches.challengeId, challenges.id))
    .where(eq(challengeMatches.matcherId, userId))
    .orderBy(desc(challengeMatches.createdAt))
    .limit(100);

  // Head-to-head challenges the user was invited to (by email) but hasn't accepted yet have no
  // match row, so surface them here too. Invited emails are stored normalized (lowercased).
  const { email } = await getUserContact(env, userId);
  const invitedRows = email
    ? await db
        .select()
        .from(challenges)
        .where(and(eq(challenges.invitedOpponentEmail, email.trim().toLowerCase()), eq(challenges.status, "pending_acceptance")))
        .orderBy(desc(challenges.createdAt))
        .limit(100)
    : [];

  const uniqueChallenges = new Map<string, Challenge>();
  for (const row of [...createdRows, ...matchedRows.map((row) => row.challenge), ...invitedRows]) {
    if (!uniqueChallenges.has(row.id)) {
      uniqueChallenges.set(row.id, toChallenge(row));
    }
  }
  return [...uniqueChallenges.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}

export async function listUserMatches(env: Env, userId: string): Promise<ChallengeMatch[]> {
  const db = createDb(env.DATABASE_URL);
  const result = await db
    .select()
    .from(challengeMatches)
    .where(eq(challengeMatches.matcherId, userId))
    .orderBy(desc(challengeMatches.createdAt))
    .limit(100);
  return result.map((row) => toChallengeMatch(row));
}

export async function getUserContact(env: Env, userId: string): Promise<{ email: string | null; displayName: string | null }> {
  const db = createDb(env.DATABASE_URL);
  const rows = await db
    .select({ appEmail: appUsers.email, appName: appUsers.displayName, authEmail: authUser.email, authName: authUser.name })
    .from(appUsers)
    .leftJoin(authUser, eq(appUsers.id, authUser.id))
    .where(eq(appUsers.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { email: null, displayName: null };
  }
  return {
    email: (row.authEmail ?? row.appEmail)?.trim() || null,
    displayName: (row.appName ?? row.authName)?.trim() || null
  };
}

export async function getChallengeRequiredApps(env: Env, challengeId: string): Promise<RequiredApp[]> {
  const db = createDb(env.DATABASE_URL);
  const rows = await db
    .select()
    .from(challengeRequiredApps)
    .where(eq(challengeRequiredApps.challengeId, challengeId))
    .orderBy(challengeRequiredApps.createdAt);
  return rows.map((row) => ({
    appSlug: row.appSlug,
    appName: row.appName,
    creatorConnectionId: row.creatorConnectionId,
    opponentConnectionId: row.opponentConnectionId
  }));
}

export async function getChallenge(env: Env, id: string): Promise<Challenge | null> {
  const db = createDb(env.DATABASE_URL);
  const result = await db
    .select({
      challenge: challenges,
      displayName: appUsers.displayName,
      authName: authUser.name
    })
    .from(challenges)
    .leftJoin(appUsers, eq(challenges.creatorId, appUsers.id))
    .leftJoin(authUser, eq(challenges.creatorId, authUser.id))
    .where(eq(challenges.id, id))
    .limit(1);
  if (!result[0]) {
    return null;
  }
  const challenge = toChallenge(result[0].challenge, { displayName: result[0].displayName, authName: result[0].authName });
  if (challenge.kind === "head_to_head") {
    challenge.requiredApps = await getChallengeRequiredApps(env, id);
    // The opponent's display name once they've accepted; otherwise fall back to the invited email
    // so the UI always has a concrete competitor label.
    if (challenge.invitedOpponentId) {
      const contact = await getUserContact(env, challenge.invitedOpponentId);
      challenge.invitedOpponentName = contact.displayName || challenge.invitedOpponentEmail || null;
    } else {
      challenge.invitedOpponentName = challenge.invitedOpponentEmail ?? null;
    }
  }
  return challenge;
}

export async function listMatches(env: Env, challengeId: string): Promise<ChallengeMatch[]> {
  const db = createDb(env.DATABASE_URL);
  const result = await db
    .select({
      match: challengeMatches,
      displayName: appUsers.displayName,
      authName: authUser.name
    })
    .from(challengeMatches)
    .leftJoin(appUsers, eq(challengeMatches.matcherId, appUsers.id))
    .leftJoin(authUser, eq(challengeMatches.matcherId, authUser.id))
    .where(eq(challengeMatches.challengeId, challengeId))
    .orderBy(challengeMatches.createdAt);
  return result.map((row) => toChallengeMatch(row.match, { displayName: row.displayName, authName: row.authName }));
}

export async function listResolutionRuns(env: Env, challengeId: string): Promise<ResolutionRun[]> {
  const db = createDb(env.DATABASE_URL);
  const result = await db
    .select()
    .from(resolutionRuns)
    .where(eq(resolutionRuns.challengeId, challengeId))
    .orderBy(desc(resolutionRuns.createdAt))
    .limit(10);
  return result.map(toResolutionRun);
}

export async function listResolutionEvents(env: Env, challengeId: string): Promise<ResolutionEvent[]> {
  const db = createDb(env.DATABASE_URL);
  const result = await db
    .select()
    .from(resolutionEvents)
    .where(eq(resolutionEvents.challengeId, challengeId))
    .orderBy(resolutionEvents.createdAt)
    .limit(80);
  return result.map(toResolutionEvent);
}

export async function actorFromRequest(env: Env, request: Request): Promise<{ userId: string; scopes: string[] }> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const { hashApiKey } = await import("@moltbooky/core/domain/apiKeys");
    const keyHash = await hashApiKey(authorization.slice("Bearer ".length));
    const db = createDb(env.DATABASE_URL);
    const result = await db
      .select({
        userId: apiKeys.userId,
        scopes: apiKeys.scopes
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);
    const key = result[0];

    if (!key) {
      throw new Error("Invalid API key.");
    }

    await ensureBetaUser(env, key.userId);
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.keyHash, keyHash));
    return { userId: key.userId, scopes: JSON.parse(key.scopes) as string[] };
  }

  const sessionUserId = await getSessionUserId(env, request);
  if (sessionUserId) {
    await ensureBetaUser(env, sessionUserId);
    return { userId: sessionUserId, scopes: ["*"] };
  }

  const hostname = new URL(request.url).hostname;
  if ((hostname === "localhost" || hostname === "127.0.0.1") && env.DEV_USER_HEADER_ENABLED !== "false") {
    const userId = request.headers.get("x-user-id") ?? "local-dev-user";
    await ensureBetaUser(env, userId);
    return { userId, scopes: ["*"] };
  }

  throw new Error("Sign in with Better Auth or use a valid agent API key.");
}

export function requireScope(actor: { scopes: string[] }, scope: string): void {
  if (!actor.scopes.includes("*") && !actor.scopes.includes(scope)) {
    throw new Error(`Missing required scope: ${scope}`);
  }
}

export function parseSide(value: unknown): Side {
  if (value === "YES" || value === "NO") {
    return value;
  }
  throw new Error("Side must be YES or NO.");
}
