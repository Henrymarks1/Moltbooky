import { describe, expect, it } from "vitest";
import { availableToMatch, oppositeSide, settleChallenge, validateMatchAmount } from "../src/domain/challenge";
import type { Challenge, ChallengeMatch } from "../src/domain/types";

const baseChallenge: Challenge = {
  id: "ch_1",
  creatorId: "creator",
  claim: "I bet YES that OpenAI launches a new model by June 30, 2026.",
  resolutionCriteria: "Resolve from official OpenAI announcements or API documentation before the expiry.",
  creatorSide: "YES",
  visibility: "public",
  stakeCents: 10_000,
  matchedCents: 0,
  status: "open",
  expiresAt: "2026-06-30T23:59:00.000Z",
  createdAt: "2026-05-25T00:00:00.000Z"
};

function match(amountCents: number, matcherId = `matcher_${amountCents}`): ChallengeMatch {
  return {
    id: `mat_${amountCents}`,
    challengeId: baseChallenge.id,
    matcherId,
    amountCents,
    side: "NO",
    status: "active",
    createdAt: "2026-05-25T00:00:00.000Z"
  };
}

describe("challenge bets", () => {
  it("tracks only matched creator exposure as at risk", () => {
    const challenge = { ...baseChallenge, matchedCents: 100 };

    expect(availableToMatch(challenge)).toBe(9_900);
    expect(() => validateMatchAmount(challenge, 9_901)).toThrow("exceeds available unmatched stake");
  });

  it("uses the opposite side for matchers", () => {
    expect(oppositeSide("YES")).toBe("NO");
    expect(oppositeSide("NO")).toBe("YES");
  });

  it("settles a $100 creator challenge with only $1 matched as a $1 live bet", () => {
    const challenge = { ...baseChallenge, matchedCents: 100 };
    const transfers = settleChallenge({ challenge, matches: [match(100, "alice")], outcome: "NO" });

    expect(transfers).toContainEqual({
      userId: "creator",
      type: "unlock",
      amountCents: 9_900,
      description: "Release unmatched challenge stake"
    });
    expect(transfers).toContainEqual({
      userId: "creator",
      type: "settlement_loss",
      amountCents: 100,
      description: "Creator lost matched challenge exposure"
    });
    expect(transfers).toContainEqual({
      userId: "alice",
      type: "settlement_win",
      amountCents: 198,
      description: "Matcher won matched challenge exposure"
    });
  });

  it("charges the 2% platform fee only on profit", () => {
    const challenge = { ...baseChallenge, matchedCents: 2_500 };
    const transfers = settleChallenge({ challenge, matches: [match(2_500, "alice")], outcome: "YES" });

    expect(transfers).toContainEqual({
      userId: "creator",
      type: "settlement_win",
      amountCents: 4_950,
      description: "Creator won matched challenge exposure"
    });
    expect(transfers).toContainEqual({
      userId: "creator",
      type: "fee",
      amountCents: 50,
      description: "2% platform fee on creator profit"
    });
  });

  it("settles multiple matchers independently", () => {
    const challenge = { ...baseChallenge, matchedCents: 3_000 };
    const transfers = settleChallenge({
      challenge,
      matches: [match(1_000, "alice"), match(2_000, "bob")],
      outcome: "NO"
    });

    expect(transfers).toContainEqual({
      userId: "alice",
      type: "settlement_win",
      amountCents: 1_980,
      description: "Matcher won matched challenge exposure"
    });
    expect(transfers).toContainEqual({
      userId: "bob",
      type: "settlement_win",
      amountCents: 3_960,
      description: "Matcher won matched challenge exposure"
    });
  });
});
