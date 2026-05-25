import { and, apiKeys, challengeMatches, challenges, createDb, desc, eq, gte, isNull, ledgerEntries, users, walletAccounts } from "@moltbooky/db";
import type { Challenge, ChallengeMatch, Side, WalletAccount } from "@moltbooky/core/domain/types";
import { getSessionUserId } from "./auth";

function serializeTimestamp(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function toChallenge(row: typeof challenges.$inferSelect): Challenge {
  return {
    id: row.id,
    creatorId: row.creatorId,
    claim: row.claim,
    resolutionCriteria: row.resolutionCriteria,
    creatorSide: row.creatorSide as Challenge["creatorSide"],
    stakeCents: row.stakeCents,
    matchedCents: row.matchedCents,
    status: row.status as Challenge["status"],
    expiresAt: serializeTimestamp(row.expiresAt)!,
    disputeDeadlineAt: serializeTimestamp(row.disputeDeadlineAt),
    provisionalOutcome: row.provisionalOutcome as Challenge["provisionalOutcome"],
    createdAt: serializeTimestamp(row.createdAt)!
  };
}

function toChallengeMatch(row: typeof challengeMatches.$inferSelect): ChallengeMatch {
  return {
    id: row.id,
    challengeId: row.challengeId,
    matcherId: row.matcherId,
    amountCents: row.amountCents,
    side: row.side as ChallengeMatch["side"],
    status: row.status as ChallengeMatch["status"],
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
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (existing.length > 0) {
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({
        id: userId,
        email: `${userId}@moltbooky.local`,
        displayName: userId,
        betaStatus: "invited"
      })
      .onConflictDoNothing();

    await tx
      .insert(walletAccounts)
      .values({
        userId,
        availableCents: 25_000
      })
      .onConflictDoNothing();
  });
}

export async function getWallet(env: Env, userId: string): Promise<WalletAccount> {
  const db = createDb(env.DATABASE_URL);
  const result = await db
    .select({
      userId: walletAccounts.userId,
      availableCents: walletAccounts.availableCents,
      lockedCents: walletAccounts.lockedCents,
      pendingWithdrawalCents: walletAccounts.pendingWithdrawalCents
    })
    .from(walletAccounts)
    .where(eq(walletAccounts.userId, userId))
    .limit(1);

  if (!result[0]) {
    throw new Error("Wallet not found.");
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
    const wallet = await tx
      .select()
      .from(walletAccounts)
      .where(and(eq(walletAccounts.userId, userId), gte(walletAccounts.availableCents, amountCents)))
      .for("update")
      .limit(1);

    if (!wallet[0]) {
      throw new Error("Insufficient available balance.");
    }

    await tx
      .update(walletAccounts)
      .set({
        availableCents: wallet[0].availableCents - amountCents,
        lockedCents: wallet[0].lockedCents + amountCents,
        updatedAt: new Date()
      })
      .where(eq(walletAccounts.userId, userId));

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
  const result = await db.select().from(challenges).orderBy(desc(challenges.createdAt)).limit(100);
  return result.map(toChallenge);
}

export async function getChallenge(env: Env, id: string): Promise<Challenge | null> {
  const db = createDb(env.DATABASE_URL);
  const result = await db.select().from(challenges).where(eq(challenges.id, id)).limit(1);
  return result[0] ? toChallenge(result[0]) : null;
}

export async function listMatches(env: Env, challengeId: string): Promise<ChallengeMatch[]> {
  const db = createDb(env.DATABASE_URL);
  const result = await db
    .select()
    .from(challengeMatches)
    .where(eq(challengeMatches.challengeId, challengeId))
    .orderBy(challengeMatches.createdAt);
  return result.map(toChallengeMatch);
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

  if (env.PAYMENT_LAUNCH_APPROVED !== "true") {
    const devUserId = request.headers.get("x-user-id");
    if (devUserId) {
      await ensureBetaUser(env, devUserId);
      return { userId: devUserId, scopes: ["*"] };
    }
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
