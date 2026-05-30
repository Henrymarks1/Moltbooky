import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { apiKeys, appUsers, challengeMatches, challenges, ledgerEntries, creditAccounts } from "./schema";

describe("database schema", () => {
  it("keeps core table names stable for migrations and queries", () => {
    expect(getTableName(appUsers)).toBe("app_users");
    expect(getTableName(creditAccounts)).toBe("credit_accounts");
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
    expect(Object.keys(creditAccounts)).toEqual(expect.arrayContaining(["availableCents", "lockedCents"]));
  });
});
