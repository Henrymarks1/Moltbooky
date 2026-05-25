import { describe, expect, it } from "vitest";
import { creditsToCents, formatCredits } from "../src/domain/money";

describe("platform credits", () => {
  it("stores credits in cent precision for ledger math", () => {
    expect(creditsToCents("25")).toBe(2500);
    expect(creditsToCents("25.50")).toBe(2550);
  });

  it("formats cent balances as platform credits", () => {
    expect(formatCredits(100)).toBe("1 credit");
    expect(formatCredits(2550)).toBe("25.50 credits");
  });
});
