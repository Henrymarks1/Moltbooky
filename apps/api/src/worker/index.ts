import { Hono } from "hono";
import { availableToMatch, oppositeSide, settleChallenge, validateChallengeInput, validateMatchAmount } from "@moltbooky/core/domain/challenge";
import { DEFAULT_AGENT_POLICY, createApiKeySecret, hashApiKey } from "@moltbooky/core/domain/apiKeys";
import { dollarsToCents } from "@moltbooky/core/domain/money";
import type { Challenge, ChallengeMatch, Side } from "@moltbooky/core/domain/types";
import {
  actorFromRequest,
  ensureBetaUser,
  getChallenge,
  getSql,
  getWallet,
  json,
  listChallenges,
  listMatches,
  lockFunds,
  newId,
  parseSide,
  requireScope
} from "./db";
import { createAuth } from "./auth";
import { enqueueOpenChallenges, resolveChallenge } from "./resolver";

const app = new Hono<{ Bindings: Env }>();

app.onError((error) => json({ error: error.message }, { status: 400 }));

app.get("/api/health", (c) => c.json({ ok: true, name: "Moltbooky" }));

app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

app.get("/api/challenges", async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  requireScope(actor, "challenges:read");
  return c.json({ challenges: await listChallenges(c.env) });
});

app.post("/api/challenges", async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
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
    env: c.env,
    userId: actor.userId,
    amountCents: stakeCents,
    type: "lock",
    challengeId,
    description: "Lock creator challenge stake",
    idempotencyKey: `challenge-create:${challengeId}`
  });

  const sql = getSql(c.env);
  await sql`
    INSERT INTO challenges (id, creator_id, claim, resolution_criteria, creator_side, stake_cents, status, expires_at)
    VALUES (${challengeId}, ${actor.userId}, ${body.claim!.trim()}, ${body.resolutionCriteria!.trim()}, ${creatorSide}, ${stakeCents}, 'open', ${body.expiresAt})
  `;

  return c.json({ challenge: await getChallenge(c.env, challengeId) }, 201);
});

app.get("/api/challenges/:id", async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  requireScope(actor, "challenges:read");
  const challenge = await getChallenge(c.env, c.req.param("id"));
  if (!challenge) {
    return c.json({ error: "Challenge not found." }, 404);
  }
  return c.json({
    challenge,
    matches: await listMatches(c.env, challenge.id),
    availableToMatchCents: availableToMatch(challenge)
  });
});

app.post("/api/challenges/:id/matches", async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  requireScope(actor, "matches:create");

  const body = (await c.req.json()) as { amountDollars?: string | number; amountCents?: number };
  const challenge = await getChallenge(c.env, c.req.param("id"));
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
  const actor = await actorFromRequest(c.env, c.req.raw);
  const challenge = await getChallenge(c.env, c.req.param("id"));
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

  const sql = getSql(c.env);
  await sql.transaction([
    sql`
      UPDATE wallet_accounts
      SET available_cents = available_cents + ${unmatched},
          locked_cents = locked_cents - ${unmatched},
          updated_at = now()
      WHERE user_id = ${actor.userId}
    `,
    sql`
      INSERT INTO ledger_entries (id, user_id, type, amount_cents, challenge_id, idempotency_key, description)
      VALUES (${newId("led")}, ${actor.userId}, 'unlock', ${unmatched}, ${challenge.id}, ${`cancel-unmatched:${challenge.id}:${Date.now()}`}, 'Release unmatched creator stake')
    `,
    sql`
      UPDATE challenges
      SET stake_cents = matched_cents,
          status = CASE WHEN matched_cents = 0 THEN 'cancelled' ELSE status END,
          updated_at = now()
      WHERE id = ${challenge.id}
    `
  ]);

  return c.json({ challenge: await getChallenge(c.env, challenge.id), unlockedCents: unmatched });
});

app.get("/api/wallet", async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  requireScope(actor, "wallet:read");
  return c.json({ wallet: await getWallet(c.env, actor.userId) });
});

app.get("/api/ledger", async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  requireScope(actor, "wallet:read");
  const sql = getSql(c.env);
  const ledger = await sql`
    SELECT id,
           type,
           amount_cents as "amountCents",
           challenge_id as "challengeId",
           match_id as "matchId",
           description,
           created_at as "createdAt"
    FROM ledger_entries
    WHERE user_id = ${actor.userId}
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return c.json({ ledger });
});

app.post("/api/api-keys", async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  const secret = createApiKeySecret();
  const id = newId("key");

  const sql = getSql(c.env);
  await sql`
    INSERT INTO api_keys (id, user_id, name, key_hash, scopes, max_stake_cents, daily_stake_limit_cents, allow_categories, deny_categories)
    VALUES (
      ${id},
      ${actor.userId},
      ${body.name?.trim() || "Agent key"},
      ${await hashApiKey(secret)},
      ${JSON.stringify(DEFAULT_AGENT_POLICY.scopes)},
      ${DEFAULT_AGENT_POLICY.maxStakeCents},
      ${DEFAULT_AGENT_POLICY.dailyStakeLimitCents},
      ${JSON.stringify(DEFAULT_AGENT_POLICY.allowCategories)},
      ${JSON.stringify(DEFAULT_AGENT_POLICY.denyCategories)}
    )
  `;

  return c.json({ apiKey: { id, secret, policy: DEFAULT_AGENT_POLICY } }, 201);
});

app.delete("/api/api-keys/:id", async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  const sql = getSql(c.env);
  await sql`UPDATE api_keys SET revoked_at = now() WHERE id = ${c.req.param("id")} AND user_id = ${actor.userId}`;
  return c.json({ ok: true });
});

app.post("/api/payments/deposits", async (c) => {
  if (c.env.PAYMENT_LAUNCH_APPROVED !== "true") {
    return c.json({ error: "Real-money deposits are disabled until legal and Stripe approval are complete." }, 403);
  }
  return c.json({ error: "Stripe checkout integration is intentionally gated for private beta approval." }, 501);
});

app.post("/api/admin/challenges/:id/finalize", async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  if (actor.userId !== "admin") {
    return c.json({ error: "Admin only." }, 403);
  }

  const body = (await c.req.json()) as { outcome?: Side };
  const outcome = parseSide(body.outcome);
  const challenge = await getChallenge(c.env, c.req.param("id"));
  if (!challenge) {
    return c.json({ error: "Challenge not found." }, 404);
  }
  const matches = await listMatches(c.env, challenge.id);
  await applySettlement(c.env, challenge, matches, outcome);
  return c.json({ challenge: await getChallenge(c.env, challenge.id) });
});

app.post("/api/admin/challenges/:id/void", async (c) => {
  const actor = await actorFromRequest(c.env, c.req.raw);
  if (actor.userId !== "admin") {
    return c.json({ error: "Admin only." }, 403);
  }
  const challenge = await getChallenge(c.env, c.req.param("id"));
  if (!challenge) {
    return c.json({ error: "Challenge not found." }, 404);
  }
  const matches = await listMatches(c.env, challenge.id);
  const sql = getSql(c.env);
  const statements = [
    sql`
      UPDATE wallet_accounts
      SET available_cents = available_cents + ${challenge.stakeCents},
          locked_cents = locked_cents - ${challenge.stakeCents},
          updated_at = now()
      WHERE user_id = ${challenge.creatorId}
    `,
    sql`UPDATE challenges SET status = 'voided', updated_at = now() WHERE id = ${challenge.id}`
  ];
  for (const match of matches) {
    statements.push(
      sql`
        UPDATE wallet_accounts
        SET available_cents = available_cents + ${match.amountCents},
            locked_cents = locked_cents - ${match.amountCents},
            updated_at = now()
        WHERE user_id = ${match.matcherId}
      `
    );
  }
  await sql.transaction(statements);
  return c.json({ challenge: await getChallenge(c.env, challenge.id) });
});

async function applySettlement(env: Env, challenge: Challenge, matches: ChallengeMatch[], outcome: Side): Promise<void> {
  const sql = getSql(env);
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
        sql`
          UPDATE wallet_accounts
          SET available_cents = available_cents + ${transfer.amountCents},
              locked_cents = locked_cents - ${transfer.amountCents},
              updated_at = now()
          WHERE user_id = ${transfer.userId}
        `
      );
    } else if (transfer.type === "settlement_win") {
      const lockedStake = lockedExposure.get(transfer.userId) ?? 0;
      statements.push(
        sql`
          UPDATE wallet_accounts
          SET available_cents = available_cents + ${transfer.amountCents},
              locked_cents = locked_cents - ${lockedStake},
              updated_at = now()
          WHERE user_id = ${transfer.userId}
        `
      );
    } else if (transfer.type === "settlement_loss") {
      statements.push(
        sql`
          UPDATE wallet_accounts
          SET locked_cents = locked_cents - ${transfer.amountCents},
              updated_at = now()
          WHERE user_id = ${transfer.userId}
        `
      );
    }

    statements.push(
      sql`
        INSERT INTO ledger_entries (id, user_id, type, amount_cents, challenge_id, idempotency_key, description)
        VALUES (
          ${newId("led")},
          ${transfer.userId},
          ${transfer.type},
          ${transfer.amountCents},
          ${challenge.id},
          ${`settle:${challenge.id}:${transfer.userId}:${transfer.type}:${newId("idem")}`},
          ${transfer.description}
        )
      `
    );
  }

  statements.push(
    sql`UPDATE challenge_matches SET status = 'settled' WHERE challenge_id = ${challenge.id}`,
    sql`UPDATE challenges SET status = 'final_resolved', provisional_outcome = ${outcome}, updated_at = now() WHERE id = ${challenge.id}`
  );
  await sql.transaction(statements);
}

export class ChallengeObject {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as { challengeId: string; matcherId: string; amountCents: number };
    const challenge = await getChallenge(this.env, body.challengeId);
    if (!challenge) {
      return json({ error: "Challenge not found." }, { status: 404 });
    }

    validateMatchAmount(challenge, body.amountCents);
    const matchId = newId("mat");
    const side = oppositeSide(challenge.creatorSide);

    await lockFunds({
      env: this.env,
      userId: body.matcherId,
      amountCents: body.amountCents,
      type: "match_lock",
      challengeId: challenge.id,
      matchId,
      description: "Lock matcher challenge stake",
      idempotencyKey: `challenge-match:${matchId}`
    });

    const sql = getSql(this.env);
    await sql.transaction([
      sql`
        INSERT INTO challenge_matches (id, challenge_id, matcher_id, amount_cents, side)
        VALUES (${matchId}, ${challenge.id}, ${body.matcherId}, ${body.amountCents}, ${side})
      `,
      sql`
        UPDATE challenges
        SET matched_cents = matched_cents + ${body.amountCents},
            updated_at = now()
        WHERE id = ${challenge.id}
      `
    ]);

    return json({ challenge: await getChallenge(this.env, challenge.id), match: { id: matchId, amountCents: body.amountCents, side } }, { status: 201 });
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
