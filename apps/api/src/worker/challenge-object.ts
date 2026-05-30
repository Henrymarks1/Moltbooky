import { oppositeSide, validateMatchAmount } from "@moltbooky/core/domain/challenge";
import { challengeMatches, challenges, createDb, eq } from "@moltbooky/db";
import { getChallenge, json, lockFunds, newId } from "./db";

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

    const db = createDb(this.env.DATABASE_URL);
    await db.transaction(async (tx) => {
      const current = await tx.select().from(challenges).where(eq(challenges.id, challenge.id)).for("update").limit(1);
      if (!current[0]) {
        throw new Error("Challenge not found.");
      }

      await tx.insert(challengeMatches).values({
        id: matchId,
        challengeId: challenge.id,
        matcherId: body.matcherId,
        amountCents: body.amountCents,
        side
      });
      await tx
        .update(challenges)
        .set({
          matchedCents: current[0].matchedCents + body.amountCents,
          updatedAt: new Date()
        })
        .where(eq(challenges.id, challenge.id));
    });

    return json(
      { challenge: await getChallenge(this.env, challenge.id), match: { id: matchId, amountCents: body.amountCents, side } },
      { status: 201 }
    );
  }
}
