import {
  DISPUTE_WINDOW_HOURS,
  assertStakeWithinBetaLimits,
  profitFeeCents
} from "./money";
import type { Challenge, ChallengeMatch, SettlementTransfer, Side } from "./types";

export function oppositeSide(side: Side): Side {
  return side === "YES" ? "NO" : "YES";
}

export function availableToMatch(challenge: Pick<Challenge, "stakeCents" | "matchedCents">): number {
  return Math.max(0, challenge.stakeCents - challenge.matchedCents);
}

export function validateChallengeInput(input: {
  claim: string;
  resolutionCriteria: string;
  stakeCents: number;
  expiresAt: string;
}): void {
  if (input.claim.trim().length < 12) {
    throw new Error("Claim must be at least 12 characters.");
  }
  if (input.resolutionCriteria.trim().length < 24) {
    throw new Error("Resolution criteria must explain how the bet should be judged.");
  }
  assertStakeWithinBetaLimits(input.stakeCents);

  const expiry = new Date(input.expiresAt).getTime();
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new Error("Expiry must be a future date.");
  }
}

export function validateMatchAmount(challenge: Challenge, amountCents: number): void {
  if (challenge.status !== "open") {
    throw new Error("Only open challenges can be matched.");
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Match amount must be a positive whole-cent amount.");
  }
  if (amountCents > availableToMatch(challenge)) {
    throw new Error("Match amount exceeds available unmatched stake.");
  }
}

export function provisionalDisputeDeadline(now = new Date()): string {
  return new Date(now.getTime() + DISPUTE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
}

export function settleChallenge(params: {
  challenge: Challenge;
  matches: ChallengeMatch[];
  outcome: Side;
}): SettlementTransfer[] {
  const { challenge, matches, outcome } = params;
  const transfers: SettlementTransfer[] = [];
  const creatorWins = challenge.creatorSide === outcome;
  const totalMatched = matches.reduce((sum, match) => sum + match.amountCents, 0);
  const unmatched = availableToMatch({ ...challenge, matchedCents: totalMatched });

  if (unmatched > 0) {
    transfers.push({
      userId: challenge.creatorId,
      type: "unlock",
      amountCents: unmatched,
      description: "Release unmatched challenge stake"
    });
  }

  if (creatorWins) {
    const profit = totalMatched;
    const fee = profitFeeCents(profit);
    transfers.push({
      userId: challenge.creatorId,
      type: "settlement_win",
      amountCents: totalMatched + profit - fee,
      description: "Creator won matched challenge exposure"
    });
    if (fee > 0) {
      transfers.push({
        userId: challenge.creatorId,
        type: "fee",
        amountCents: -fee,
        description: "2% platform fee on creator profit"
      });
    }
    for (const match of matches) {
      transfers.push({
        userId: match.matcherId,
        type: "settlement_loss",
        amountCents: match.amountCents,
        description: "Matcher lost matched challenge exposure"
      });
    }
    return transfers;
  }

  transfers.push({
    userId: challenge.creatorId,
    type: "settlement_loss",
    amountCents: totalMatched,
    description: "Creator lost matched challenge exposure"
  });

  for (const match of matches) {
    const fee = profitFeeCents(match.amountCents);
    transfers.push({
      userId: match.matcherId,
      type: "settlement_win",
      amountCents: match.amountCents * 2 - fee,
      description: "Matcher won matched challenge exposure"
    });
    if (fee > 0) {
      transfers.push({
        userId: match.matcherId,
        type: "fee",
        amountCents: -fee,
        description: "2% platform fee on matcher profit"
      });
    }
  }

  return transfers;
}
