import { neon } from "@neondatabase/serverless";
import type { Challenge, ChallengeMatch, Side, WalletAccount } from "@moltbooky/core/domain/types";
import { getSessionUserId } from "./auth";

export type Sql = ReturnType<typeof neon>;

export function getSql(env: Env): Sql {
  return neon(env.DATABASE_URL);
}

function rows<T>(value: unknown): T[] {
  return value as T[];
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
  const sql = getSql(env);
  const existing = rows<{ id: string }>(await sql`SELECT id FROM users WHERE id = ${userId} LIMIT 1`);
  if (existing.length > 0) {
    return;
  }

  await sql.transaction([
    sql`INSERT INTO users (id, email, display_name, beta_status) VALUES (${userId}, ${`${userId}@moltbooky.local`}, ${userId}, 'invited') ON CONFLICT (id) DO NOTHING`,
    sql`INSERT INTO wallet_accounts (user_id, available_cents) VALUES (${userId}, ${25_000}) ON CONFLICT (user_id) DO NOTHING`
  ]);
}

export async function getWallet(env: Env, userId: string): Promise<WalletAccount> {
  const sql = getSql(env);
  const result = rows<WalletAccount>(await sql`
    SELECT user_id as "userId",
           available_cents as "availableCents",
           locked_cents as "lockedCents",
           pending_withdrawal_cents as "pendingWithdrawalCents"
    FROM wallet_accounts
    WHERE user_id = ${userId}
    LIMIT 1
  `);

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
  const wallet = await getWallet(env, userId);
  if (wallet.availableCents < amountCents) {
    throw new Error("Insufficient available balance.");
  }

  const sql = getSql(env);
  await sql.transaction([
    sql`
      UPDATE wallet_accounts
      SET available_cents = available_cents - ${amountCents},
          locked_cents = locked_cents + ${amountCents},
          updated_at = now()
      WHERE user_id = ${userId}
    `,
    sql`
      INSERT INTO ledger_entries (id, user_id, type, amount_cents, challenge_id, match_id, idempotency_key, description)
      VALUES (${newId("led")}, ${userId}, ${type}, ${amountCents}, ${challengeId}, ${matchId ?? null}, ${idempotencyKey}, ${description})
    `
  ]);
}

export async function listChallenges(env: Env): Promise<Challenge[]> {
  const sql = getSql(env);
  const result = rows<Challenge>(await sql`
    SELECT id,
           creator_id as "creatorId",
           claim,
           resolution_criteria as "resolutionCriteria",
           creator_side as "creatorSide",
           stake_cents as "stakeCents",
           matched_cents as "matchedCents",
           status,
           expires_at as "expiresAt",
           dispute_deadline_at as "disputeDeadlineAt",
           provisional_outcome as "provisionalOutcome",
           created_at as "createdAt"
    FROM challenges
    ORDER BY created_at DESC
    LIMIT 100
  `);
  return result;
}

export async function getChallenge(env: Env, id: string): Promise<Challenge | null> {
  const sql = getSql(env);
  const result = rows<Challenge>(await sql`
    SELECT id,
           creator_id as "creatorId",
           claim,
           resolution_criteria as "resolutionCriteria",
           creator_side as "creatorSide",
           stake_cents as "stakeCents",
           matched_cents as "matchedCents",
           status,
           expires_at as "expiresAt",
           dispute_deadline_at as "disputeDeadlineAt",
           provisional_outcome as "provisionalOutcome",
           created_at as "createdAt"
    FROM challenges
    WHERE id = ${id}
    LIMIT 1
  `);
  return result[0] ?? null;
}

export async function listMatches(env: Env, challengeId: string): Promise<ChallengeMatch[]> {
  const sql = getSql(env);
  const result = rows<ChallengeMatch>(await sql`
    SELECT id,
           challenge_id as "challengeId",
           matcher_id as "matcherId",
           amount_cents as "amountCents",
           side,
           status,
           created_at as "createdAt"
    FROM challenge_matches
    WHERE challenge_id = ${challengeId}
    ORDER BY created_at ASC
  `);
  return result;
}

export async function actorFromRequest(env: Env, request: Request): Promise<{ userId: string; scopes: string[] }> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const { hashApiKey } = await import("@moltbooky/core/domain/apiKeys");
    const keyHash = await hashApiKey(authorization.slice("Bearer ".length));
    const sql = getSql(env);
    const result = rows<{ userId: string; scopes: string }>(await sql`
      SELECT user_id as "userId", scopes
      FROM api_keys
      WHERE key_hash = ${keyHash}
        AND revoked_at IS NULL
      LIMIT 1
    `);
    const key = result[0];

    if (!key) {
      throw new Error("Invalid API key.");
    }

    await ensureBetaUser(env, key.userId);
    await sql`UPDATE api_keys SET last_used_at = now() WHERE key_hash = ${keyHash}`;
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
