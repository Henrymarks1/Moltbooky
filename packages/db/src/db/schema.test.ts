import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { apiKeys, challengeMatches, challenges, ledgerEntries, users, walletAccounts } from "./schema";

describe("database schema", () => {
  it("keeps core table names stable for migrations and queries", () => {
    expect(getTableName(users)).toBe("users");
    expect(getTableName(walletAccounts)).toBe("wallet_accounts");
    expect(getTableName(ledgerEntries)).toBe("ledger_entries");
    expect(getTableName(challenges)).toBe("challenges");
    expect(getTableName(challengeMatches)).toBe("challenge_matches");
    expect(getTableName(apiKeys)).toBe("api_keys");
  });

  it("exposes expected columns for the challenge ledger flow", () => {
    expect(Object.keys(challenges)).toEqual(
      expect.arrayContaining(["id", "creatorId", "stakeCents", "matchedCents", "status"])
    );
    expect(Object.keys(challengeMatches)).toEqual(expect.arrayContaining(["challengeId", "matcherId", "amountCents"]));
    expect(Object.keys(ledgerEntries)).toEqual(expect.arrayContaining(["userId", "type", "amountCents", "idempotencyKey"]));
    expect(Object.keys(walletAccounts)).toEqual(expect.arrayContaining(["availableCents", "lockedCents"]));
  });
});
