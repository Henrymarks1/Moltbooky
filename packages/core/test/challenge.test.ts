import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  availableToMatch,
  oppositeSide,
  provisionalDisputeDeadline,
  settleChallenge,
  validateChallengeInput,
  validateMatchAmount
} from "../src/domain/challenge";
import type { Challenge, ChallengeMatch } from "../src/domain/types";

const baseChallenge: Challenge = {
  id: "ch_1",
  creatorId: "creator",
  claim: "I bet YES that OpenAI launches a new model by June 30, 2026.",
  resolutionCriteria: "Resolve from official OpenAI announcements or API documentation before the expiry.",
  pipedreamConnectionIds: [],
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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks only matched creator exposure as at risk", () => {
    const challenge = { ...baseChallenge, matchedCents: 100 };

    expect(availableToMatch(challenge)).toBe(9_900);
    expect(availableToMatch({ ...challenge, matchedCents: 10_001 })).toBe(0);
    expect(() => validateMatchAmount(challenge, 9_901)).toThrow("exceeds available unmatched stake");
  });

  it("uses the opposite side for matchers", () => {
    expect(oppositeSide("YES")).toBe("NO");
    expect(oppositeSide("NO")).toBe("YES");
  });

  it("validates challenge creation input", () => {
    expect(() =>
      validateChallengeInput({
        claim: baseChallenge.claim,
        resolutionCriteria: baseChallenge.resolutionCriteria,
        stakeCents: 500,
        expiresAt: baseChallenge.expiresAt
      })
    ).not.toThrow();

    expect(() =>
      validateChallengeInput({
        claim: "Too short",
        resolutionCriteria: baseChallenge.resolutionCriteria,
        stakeCents: 500,
        expiresAt: baseChallenge.expiresAt
      })
    ).toThrow("Claim must be at least 12 characters");

    expect(() =>
      validateChallengeInput({
        claim: baseChallenge.claim,
        resolutionCriteria: "Too short",
        stakeCents: 500,
        expiresAt: baseChallenge.expiresAt
      })
    ).toThrow("Resolution criteria");

    expect(() =>
      validateChallengeInput({
        claim: baseChallenge.claim,
        resolutionCriteria: baseChallenge.resolutionCriteria,
        stakeCents: 499,
        expiresAt: baseChallenge.expiresAt
      })
    ).toThrow("Minimum challenge stake");

    expect(() =>
      validateChallengeInput({
        claim: baseChallenge.claim,
        resolutionCriteria: baseChallenge.resolutionCriteria,
        stakeCents: 500,
        expiresAt: "2026-05-24T23:59:59.000Z"
      })
    ).toThrow("future date");
  });

  it("validates match eligibility and amount", () => {
    expect(() => validateMatchAmount({ ...baseChallenge, matchedCents: 0 }, 500)).not.toThrow();
    expect(() => validateMatchAmount({ ...baseChallenge, status: "final_resolved" }, 500)).toThrow(
      "Only open challenges"
    );
    expect(() => validateMatchAmount(baseChallenge, 0)).toThrow("positive whole-cent");
    expect(() => validateMatchAmount(baseChallenge, 1.5)).toThrow("positive whole-cent");
  });

  it("sets provisional dispute deadlines relative to the supplied time", () => {
    expect(provisionalDisputeDeadline(new Date("2026-05-25T12:00:00.000Z"))).toBe(
      "2026-05-26T12:00:00.000Z"
    );
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
      amountCents: -50,
      description: "2% platform fee on creator profit"
    });
  });

  it("does not emit a fee transfer when rounded fee is zero", () => {
    const challenge = { ...baseChallenge, stakeCents: 10, matchedCents: 10 };
    const transfers = settleChallenge({ challenge, matches: [match(10, "alice")], outcome: "YES" });

    expect(transfers).toContainEqual({
      userId: "creator",
      type: "settlement_win",
      amountCents: 20,
      description: "Creator won matched challenge exposure"
    });
    expect(transfers).not.toContainEqual(
      expect.objectContaining({
        type: "fee"
      })
    );
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
      userId: "alice",
      type: "fee",
      amountCents: -20,
      description: "2% platform fee on matcher profit"
    });
    expect(transfers).toContainEqual({
      userId: "bob",
      type: "settlement_win",
      amountCents: 3_960,
      description: "Matcher won matched challenge exposure"
    });
    expect(transfers).toContainEqual({
      userId: "bob",
      type: "fee",
      amountCents: -40,
      description: "2% platform fee on matcher profit"
    });
  });
});
