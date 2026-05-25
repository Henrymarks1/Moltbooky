import type { Challenge, ChallengeMatch, Side, WalletAccount } from "../domain/types";

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

export async function ensureBetaUser(db: D1Database, userId: string): Promise<void> {
  const user = await db.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (user) {
    return;
  }

  await db.batch([
    db
      .prepare("INSERT INTO users (id, email, display_name, beta_status) VALUES (?, ?, ?, 'invited')")
      .bind(userId, `${userId}@moltbooky.local`, userId),
    db.prepare("INSERT INTO wallet_accounts (user_id, available_cents) VALUES (?, ?)").bind(userId, 25_000)
  ]);
}

export async function getWallet(db: D1Database, userId: string): Promise<WalletAccount> {
  const row = await db
    .prepare(
      "SELECT user_id as userId, available_cents as availableCents, locked_cents as lockedCents, pending_withdrawal_cents as pendingWithdrawalCents FROM wallet_accounts WHERE user_id = ?"
    )
    .bind(userId)
    .first<WalletAccount>();

  if (!row) {
    throw new Error("Wallet not found.");
  }
  return row;
}

export async function lockFunds(params: {
  db: D1Database;
  userId: string;
  amountCents: number;
  type: "lock" | "match_lock";
  challengeId: string;
  matchId?: string;
  description: string;
  idempotencyKey: string;
}): Promise<void> {
  const { db, userId, amountCents, type, challengeId, matchId, description, idempotencyKey } = params;
  const wallet = await getWallet(db, userId);
  if (wallet.availableCents < amountCents) {
    throw new Error("Insufficient available balance.");
  }

  await db.batch([
    db
      .prepare(
        "UPDATE wallet_accounts SET available_cents = available_cents - ?, locked_cents = locked_cents + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
      )
      .bind(amountCents, amountCents, userId),
    db
      .prepare(
        "INSERT INTO ledger_entries (id, user_id, type, amount_cents, challenge_id, match_id, idempotency_key, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(newId("led"), userId, type, amountCents, challengeId, matchId ?? null, idempotencyKey, description)
  ]);
}

export async function listChallenges(db: D1Database): Promise<Challenge[]> {
  const { results } = await db
    .prepare(
      "SELECT id, creator_id as creatorId, claim, resolution_criteria as resolutionCriteria, creator_side as creatorSide, stake_cents as stakeCents, matched_cents as matchedCents, status, expires_at as expiresAt, dispute_deadline_at as disputeDeadlineAt, provisional_outcome as provisionalOutcome, created_at as createdAt FROM challenges ORDER BY created_at DESC LIMIT 100"
    )
    .all<Challenge>();
  return results;
}

export async function getChallenge(db: D1Database, id: string): Promise<Challenge | null> {
  return await db
    .prepare(
      "SELECT id, creator_id as creatorId, claim, resolution_criteria as resolutionCriteria, creator_side as creatorSide, stake_cents as stakeCents, matched_cents as matchedCents, status, expires_at as expiresAt, dispute_deadline_at as disputeDeadlineAt, provisional_outcome as provisionalOutcome, created_at as createdAt FROM challenges WHERE id = ?"
    )
    .bind(id)
    .first<Challenge>();
}

export async function listMatches(db: D1Database, challengeId: string): Promise<ChallengeMatch[]> {
  const { results } = await db
    .prepare(
      "SELECT id, challenge_id as challengeId, matcher_id as matcherId, amount_cents as amountCents, side, status, created_at as createdAt FROM challenge_matches WHERE challenge_id = ? ORDER BY created_at ASC"
    )
    .bind(challengeId)
    .all<ChallengeMatch>();
  return results;
}

export async function actorFromRequest(db: D1Database, request: Request): Promise<{ userId: string; scopes: string[] }> {
  const userHeader = request.headers.get("x-user-id");
  if (userHeader) {
    await ensureBetaUser(db, userHeader);
    return { userId: userHeader, scopes: ["*"] };
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Use x-user-id for beta UI auth or Bearer API key for agents.");
  }

  const { hashApiKey } = await import("../domain/apiKeys");
  const keyHash = await hashApiKey(authorization.slice("Bearer ".length));
  const key = await db
    .prepare("SELECT user_id as userId, scopes FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL")
    .bind(keyHash)
    .first<{ userId: string; scopes: string }>();

  if (!key) {
    throw new Error("Invalid API key.");
  }

  await ensureBetaUser(db, key.userId);
  await db.prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = ?").bind(keyHash).run();
  return { userId: key.userId, scopes: JSON.parse(key.scopes) as string[] };
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
