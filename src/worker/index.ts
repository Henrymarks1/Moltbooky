import { Hono } from "hono";
import { availableToMatch, oppositeSide, settleChallenge, validateChallengeInput, validateMatchAmount } from "../domain/challenge";
import { DEFAULT_AGENT_POLICY, createApiKeySecret, hashApiKey } from "../domain/apiKeys";
import { dollarsToCents } from "../domain/money";
import type { Challenge, ChallengeMatch, Side } from "../domain/types";
import {
  actorFromRequest,
  ensureBetaUser,
  getChallenge,
  getWallet,
  json,
  listChallenges,
  listMatches,
  lockFunds,
  newId,
  parseSide,
  requireScope
} from "./db";
import { enqueueOpenChallenges, resolveChallenge } from "./resolver";

const app = new Hono<{ Bindings: Env }>();

app.onError((error) => json({ error: error.message }, { status: 400 }));

app.get("/api/health", (c) => c.json({ ok: true, name: "Moltbooky" }));

app.get("/api/challenges", async (c) => {
  const actor = await actorFromRequest(c.env.DB, c.req.raw);
  requireScope(actor, "challenges:read");
  return c.json({ challenges: await listChallenges(c.env.DB) });
});

app.post("/api/challenges", async (c) => {
  const actor = await actorFromRequest(c.env.DB, c.req.raw);
  requireScope(actor, "challenges:create");

  const body = (await c.req.json()) as {
    claim?: string;
    resolutionCriteria?: string;
    creatorSide?: Side;
    stakeDollars?: string | number;
    stakeCents?: number;
    expiresAt?: string;
  };
  const stakeCents = body.stakeCents ?? dollarsToCents(body.stakeDollars ?? "");
  const creatorSide = parseSide(body.creatorSide);
  const challengeId = newId("ch");

  validateChallengeInput({
    claim: body.claim ?? "",
    resolutionCriteria: body.resolutionCriteria ?? "",
    stakeCents,
    expiresAt: body.expiresAt ?? ""
  });

  await lockFunds({
    db: c.env.DB,
    userId: actor.userId,
    amountCents: stakeCents,
    type: "lock",
    challengeId,
    description: "Lock creator challenge stake",
    idempotencyKey: `challenge-create:${challengeId}`
  });

  await c.env.DB.prepare(
    "INSERT INTO challenges (id, creator_id, claim, resolution_criteria, creator_side, stake_cents, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)"
  )
    .bind(challengeId, actor.userId, body.claim!.trim(), body.resolutionCriteria!.trim(), creatorSide, stakeCents, body.expiresAt)
    .run();

  return c.json({ challenge: await getChallenge(c.env.DB, challengeId) }, 201);
});

app.get("/api/challenges/:id", async (c) => {
  const actor = await actorFromRequest(c.env.DB, c.req.raw);
  requireScope(actor, "challenges:read");
  const challenge = await getChallenge(c.env.DB, c.req.param("id"));
  if (!challenge) {
    return c.json({ error: "Challenge not found." }, 404);
  }
  return c.json({
    challenge,
    matches: await listMatches(c.env.DB, challenge.id),
    availableToMatchCents: availableToMatch(challenge)
  });
});

app.post("/api/challenges/:id/matches", async (c) => {
  const actor = await actorFromRequest(c.env.DB, c.req.raw);
  requireScope(actor, "matches:create");

  const body = (await c.req.json()) as { amountDollars?: string | number; amountCents?: number };
  const challenge = await getChallenge(c.env.DB, c.req.param("id"));
  if (!challenge) {
    return c.json({ error: "Challenge not found." }, 404);
  }
  if (challenge.creatorId === actor.userId) {
    throw new Error("Creator cannot match their own challenge.");
  }

  const amountCents = body.amountCents ?? dollarsToCents(body.amountDollars ?? "");
  validateMatchAmount(challenge, amountCents);

  const durableId = c.env.CHALLENGE_OBJECT.idFromName(challenge.id);
  const object = c.env.CHALLENGE_OBJECT.get(durableId);
  return object.fetch(new Request("https://challenge-object/match", {
    method: "POST",
    body: JSON.stringify({ challengeId: challenge.id, matcherId: actor.userId, amountCents })
  }));
});

app.post("/api/challenges/:id/cancel-unmatched", async (c) => {
  const actor = await actorFromRequest(c.env.DB, c.req.raw);
  const challenge = await getChallenge(c.env.DB, c.req.param("id"));
  if (!challenge) {
    return c.json({ error: "Challenge not found." }, 404);
  }
  if (challenge.creatorId !== actor.userId) {
    throw new Error("Only the creator can cancel unmatched stake.");
  }
  const unmatched = availableToMatch(challenge);
  if (unmatched === 0) {
    return c.json({ challenge, unlockedCents: 0 });
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE wallet_accounts SET available_cents = available_cents + ?, locked_cents = locked_cents - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
    ).bind(unmatched, unmatched, actor.userId),
    c.env.DB.prepare(
      "INSERT INTO ledger_entries (id, user_id, type, amount_cents, challenge_id, idempotency_key, description) VALUES (?, ?, 'unlock', ?, ?, ?, ?)"
    ).bind(newId("led"), actor.userId, unmatched, challenge.id, `cancel-unmatched:${challenge.id}:${Date.now()}`, "Release unmatched creator stake"),
    c.env.DB.prepare(
      "UPDATE challenges SET stake_cents = matched_cents, status = CASE WHEN matched_cents = 0 THEN 'cancelled' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(challenge.id)
  ]);

  return c.json({ challenge: await getChallenge(c.env.DB, challenge.id), unlockedCents: unmatched });
});

app.get("/api/wallet", async (c) => {
  const actor = await actorFromRequest(c.env.DB, c.req.raw);
  requireScope(actor, "wallet:read");
  return c.json({ wallet: await getWallet(c.env.DB, actor.userId) });
});

app.get("/api/ledger", async (c) => {
  const actor = await actorFromRequest(c.env.DB, c.req.raw);
  requireScope(actor, "wallet:read");
  const { results } = await c.env.DB.prepare(
    "SELECT id, type, amount_cents as amountCents, challenge_id as challengeId, match_id as matchId, description, created_at as createdAt FROM ledger_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
  )
    .bind(actor.userId)
    .all();
  return c.json({ ledger: results });
});

app.post("/api/api-keys", async (c) => {
  const actor = await actorFromRequest(c.env.DB, c.req.raw);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  const secret = createApiKeySecret();
  const id = newId("key");

  await c.env.DB.prepare(
    "INSERT INTO api_keys (id, user_id, name, key_hash, scopes, max_stake_cents, daily_stake_limit_cents, allow_categories, deny_categories) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      id,
      actor.userId,
      body.name?.trim() || "Agent key",
      await hashApiKey(secret),
      JSON.stringify(DEFAULT_AGENT_POLICY.scopes),
      DEFAULT_AGENT_POLICY.maxStakeCents,
      DEFAULT_AGENT_POLICY.dailyStakeLimitCents,
      JSON.stringify(DEFAULT_AGENT_POLICY.allowCategories),
      JSON.stringify(DEFAULT_AGENT_POLICY.denyCategories)
    )
    .run();

  return c.json({ apiKey: { id, secret, policy: DEFAULT_AGENT_POLICY } }, 201);
});

app.delete("/api/api-keys/:id", async (c) => {
  const actor = await actorFromRequest(c.env.DB, c.req.raw);
  await c.env.DB.prepare("UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), actor.userId)
    .run();
  return c.json({ ok: true });
});

app.post("/api/payments/deposits", async (c) => {
  if (c.env.PAYMENT_LAUNCH_APPROVED !== "true") {
    return c.json({ error: "Real-money deposits are disabled until legal and Stripe approval are complete." }, 403);
  }
  return c.json({ error: "Stripe checkout integration is intentionally gated for private beta approval." }, 501);
});

app.post("/api/admin/challenges/:id/finalize", async (c) => {
  const actor = await actorFromRequest(c.env.DB, c.req.raw);
  if (actor.userId !== "admin") {
    return c.json({ error: "Admin only." }, 403);
  }

  const body = (await c.req.json()) as { outcome?: Side };
  const outcome = parseSide(body.outcome);
  const challenge = await getChallenge(c.env.DB, c.req.param("id"));
  if (!challenge) {
    return c.json({ error: "Challenge not found." }, 404);
  }
  const matches = await listMatches(c.env.DB, challenge.id);
  await applySettlement(c.env.DB, challenge, matches, outcome);
  return c.json({ challenge: await getChallenge(c.env.DB, challenge.id) });
});

app.post("/api/admin/challenges/:id/void", async (c) => {
  const actor = await actorFromRequest(c.env.DB, c.req.raw);
  if (actor.userId !== "admin") {
    return c.json({ error: "Admin only." }, 403);
  }
  const challenge = await getChallenge(c.env.DB, c.req.param("id"));
  if (!challenge) {
    return c.json({ error: "Challenge not found." }, 404);
  }
  const matches = await listMatches(c.env.DB, challenge.id);
  const statements = [
    c.env.DB.prepare(
      "UPDATE wallet_accounts SET available_cents = available_cents + ?, locked_cents = locked_cents - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
    ).bind(challenge.stakeCents, challenge.stakeCents, challenge.creatorId),
    c.env.DB.prepare("UPDATE challenges SET status = 'voided', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(challenge.id)
  ];
  for (const match of matches) {
    statements.push(
      c.env.DB.prepare(
        "UPDATE wallet_accounts SET available_cents = available_cents + ?, locked_cents = locked_cents - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
      ).bind(match.amountCents, match.amountCents, match.matcherId)
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ challenge: await getChallenge(c.env.DB, challenge.id) });
});

async function applySettlement(db: D1Database, challenge: Challenge, matches: ChallengeMatch[], outcome: Side): Promise<void> {
  const statements = [];
  const lockedExposure = new Map<string, number>();
  if (challenge.creatorSide === outcome) {
    lockedExposure.set(
      challenge.creatorId,
      matches.reduce((sum, match) => sum + match.amountCents, 0)
    );
  } else {
    for (const match of matches) {
      lockedExposure.set(match.matcherId, match.amountCents);
    }
  }

  for (const transfer of settleChallenge({ challenge, matches, outcome })) {
    if (transfer.type === "unlock") {
      statements.push(
        db.prepare(
          "UPDATE wallet_accounts SET available_cents = available_cents + ?, locked_cents = locked_cents - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
        ).bind(transfer.amountCents, transfer.amountCents, transfer.userId)
      );
    } else if (transfer.type === "settlement_win") {
      const lockedStake = lockedExposure.get(transfer.userId) ?? 0;
      statements.push(
        db.prepare(
          "UPDATE wallet_accounts SET available_cents = available_cents + ?, locked_cents = locked_cents - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
        ).bind(transfer.amountCents, lockedStake, transfer.userId)
      );
    } else if (transfer.type === "settlement_loss") {
      statements.push(
        db.prepare("UPDATE wallet_accounts SET locked_cents = locked_cents - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(
          transfer.amountCents,
          transfer.userId
        )
      );
    }

    statements.push(
      db.prepare(
        "INSERT INTO ledger_entries (id, user_id, type, amount_cents, challenge_id, idempotency_key, description) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(newId("led"), transfer.userId, transfer.type, transfer.amountCents, challenge.id, `settle:${challenge.id}:${transfer.userId}:${transfer.type}:${newId("idem")}`, transfer.description)
    );
  }

  statements.push(
    db.prepare("UPDATE challenge_matches SET status = 'settled' WHERE challenge_id = ?").bind(challenge.id),
    db.prepare("UPDATE challenges SET status = 'final_resolved', provisional_outcome = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(
      outcome,
      challenge.id
    )
  );
  await db.batch(statements);
}

export class ChallengeObject {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as { challengeId: string; matcherId: string; amountCents: number };
    const challenge = await getChallenge(this.env.DB, body.challengeId);
    if (!challenge) {
      return json({ error: "Challenge not found." }, { status: 404 });
    }

    validateMatchAmount(challenge, body.amountCents);
    const matchId = newId("mat");
    const side = oppositeSide(challenge.creatorSide);

    await lockFunds({
      db: this.env.DB,
      userId: body.matcherId,
      amountCents: body.amountCents,
      type: "match_lock",
      challengeId: challenge.id,
      matchId,
      description: "Lock matcher challenge stake",
      idempotencyKey: `challenge-match:${matchId}`
    });

    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO challenge_matches (id, challenge_id, matcher_id, amount_cents, side) VALUES (?, ?, ?, ?, ?)"
      ).bind(matchId, challenge.id, body.matcherId, body.amountCents, side),
      this.env.DB.prepare("UPDATE challenges SET matched_cents = matched_cents + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(
        body.amountCents,
        challenge.id
      )
    ]);

    return json({ challenge: await getChallenge(this.env.DB, challenge.id), match: { id: matchId, amountCents: body.amountCents, side } }, { status: 201 });
  }
}

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Env) => {
    await enqueueOpenChallenges(env);
  },
  queue: async (batch: MessageBatch<{ challengeId: string }>, env: Env) => {
    for (const message of batch.messages) {
      await resolveChallenge(env, message.body.challengeId);
      message.ack();
    }
  }
};
