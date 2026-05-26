import { describe, expect, it } from "vitest";
import { matchProgress, shortDate } from "./format";
import type { Challenge } from "@moltbooky/core/domain/types";

const challenge: Challenge = {
  id: "ch_1",
  creatorId: "creator",
  claim: "A sufficiently clear claim for display tests.",
  resolutionCriteria: "A sufficiently clear resolution standard for display tests.",
  creatorSide: "YES",
  visibility: "public",
  stakeCents: 10_000,
  matchedCents: 2_500,
  status: "open",
  expiresAt: "2026-06-30T23:59:00.000Z",
  createdAt: "2026-05-25T00:00:00.000Z"
};

describe("format helpers", () => {
  it("calculates match progress as a rounded percentage", () => {
    expect(matchProgress(challenge)).toBe(25);
    expect(matchProgress({ ...challenge, stakeCents: 3, matchedCents: 2 })).toBe(67);
  });

  it("returns zero progress for zero-stake challenges", () => {
    expect(matchProgress({ ...challenge, stakeCents: 0, matchedCents: 0 })).toBe(0);
  });

  it("formats short dates for challenge cards", () => {
    expect(shortDate("2026-06-30T23:59:00.000Z")).toContain("Jun 30");
  });
});
