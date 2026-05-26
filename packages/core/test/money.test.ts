import { describe, expect, it } from "vitest";
import {
  PRIVATE_BETA_MAX_STAKE_CENTS,
  assertStakeWithinBetaLimits,
  creditsToCents,
  dollarsToCents,
  formatCredits,
  formatMoney,
  profitFeeCents
} from "../src/domain/money";

describe("dollar amounts", () => {
  it("converts whole and fractional dollar strings to cents", () => {
    expect(dollarsToCents("25")).toBe(2500);
    expect(dollarsToCents("25.5")).toBe(2550);
    expect(dollarsToCents(" 25.05 ")).toBe(2505);
  });

  it("converts number inputs using cent precision", () => {
    expect(dollarsToCents(25)).toBe(2500);
    expect(dollarsToCents(25.5)).toBe(2550);
  });

  it("rejects invalid dollar inputs", () => {
    expect(() => dollarsToCents("-1")).toThrow("positive dollar value");
    expect(() => dollarsToCents("1.234")).toThrow("at most two decimals");
    expect(() => dollarsToCents("abc")).toThrow("positive dollar value");
  });

  it("formats cent balances as USD", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
  });
});

describe("platform credits", () => {
  it("stores credits in cent precision for ledger math", () => {
    expect(creditsToCents("25")).toBe(2500);
    expect(creditsToCents("25.50")).toBe(2550);
    expect(creditsToCents(25.5)).toBe(2550);
  });

  it("rejects invalid credit inputs", () => {
    expect(() => creditsToCents("-1")).toThrow("positive credit value");
    expect(() => creditsToCents("1.234")).toThrow("at most two decimals");
    expect(() => creditsToCents("abc")).toThrow("positive credit value");
  });

  it("formats cent balances as platform credits", () => {
    expect(formatCredits(100)).toBe("1 credit");
    expect(formatCredits(200)).toBe("2 credits");
    expect(formatCredits(2550)).toBe("25.50 credits");
  });

  it("enforces private beta stake limits", () => {
    expect(() => assertStakeWithinBetaLimits(500)).not.toThrow();
    expect(() => assertStakeWithinBetaLimits(PRIVATE_BETA_MAX_STAKE_CENTS)).not.toThrow();
    expect(() => assertStakeWithinBetaLimits(0)).toThrow("positive platform credit");
    expect(() => assertStakeWithinBetaLimits(499)).toThrow("Minimum challenge stake");
    expect(() => assertStakeWithinBetaLimits(PRIVATE_BETA_MAX_STAKE_CENTS + 1)).toThrow("stake limit");
    expect(() => assertStakeWithinBetaLimits(500.5)).toThrow("positive platform credit");
  });

  it("charges fees only on positive profit and rounds down to cents", () => {
    expect(profitFeeCents(-100)).toBe(0);
    expect(profitFeeCents(0)).toBe(0);
    expect(profitFeeCents(100)).toBe(2);
    expect(profitFeeCents(199)).toBe(3);
  });
});
