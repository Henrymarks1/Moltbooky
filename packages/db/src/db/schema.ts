import { boolean, check, index, integer, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const authUser = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull()
});

export const authSession = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => authUser.id)
});

export const authAccount = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => authUser.id),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull()
});

export const authVerification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at")
});

export const appUsers = pgTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    betaStatus: text("beta_status").notNull().default("invited"),
    kycStatus: text("kyc_status").notNull().default("not_started"),
    complianceNotes: text("compliance_notes"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => ({
    emailIdx: uniqueIndex("app_users_email_unique").on(table.email)
  })
);

export const walletAccounts = pgTable(
  "wallet_accounts",
  {
    userId: text("user_id").primaryKey().references(() => appUsers.id),
    availableCents: integer("available_cents").notNull().default(0),
    lockedCents: integer("locked_cents").notNull().default(0),
    pendingWithdrawalCents: integer("pending_withdrawal_cents").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (table) => ({
    availableNonNegative: check("wallet_available_non_negative", sql`${table.availableCents} >= 0`),
    lockedNonNegative: check("wallet_locked_non_negative", sql`${table.lockedCents} >= 0`),
    pendingNonNegative: check("wallet_pending_non_negative", sql`${table.pendingWithdrawalCents} >= 0`)
  })
);

export const userPaymentProfiles = pgTable(
  "user_payment_profiles",
  {
    userId: text("user_id").primaryKey().references(() => appUsers.id),
    privyUserId: text("privy_user_id"),
    withdrawalAddress: text("withdrawal_address"),
    depositWalletId: text("deposit_wallet_id"),
    depositAddress: text("deposit_address"),
    chain: text("chain").notNull().default("base"),
    lastScannedBlock: integer("last_scanned_block"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (table) => ({
    depositAddressIdx: uniqueIndex("user_payment_profiles_deposit_address_unique").on(table.depositAddress),
    withdrawalAddressIdx: index("idx_user_payment_profiles_withdrawal").on(table.withdrawalAddress)
  })
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => appUsers.id),
    type: text("type").notNull(),
    amountCents: integer("amount_cents").notNull(),
    challengeId: text("challenge_id"),
    matchId: text("match_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => ({
    userIdx: index("idx_ledger_user").on(table.userId, table.createdAt),
    idemIdx: uniqueIndex("ledger_entries_idempotency_key_unique").on(table.idempotencyKey)
  })
);

export const cryptoTransactions = pgTable(
  "crypto_transactions",
  {
    id: text("id").primaryKey(),
    direction: text("direction").notNull(),
    userId: text("user_id").notNull().references(() => appUsers.id),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull().default(0),
    amountMicroUsdc: text("amount_micro_usdc").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull(),
    providerRef: text("provider_ref"),
    blockNumber: integer("block_number"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (table) => ({
    txLogUnique: uniqueIndex("crypto_transactions_tx_log_unique").on(table.txHash, table.logIndex),
    userIdx: index("idx_crypto_transactions_user").on(table.userId, table.createdAt),
    directionCheck: check("crypto_transactions_direction_check", sql`${table.direction} IN ('deposit', 'withdrawal')`),
    statusCheck: check("crypto_transactions_status_check", sql`${table.status} IN ('pending', 'confirmed', 'failed')`),
    amountNonNegative: check("crypto_transactions_amount_non_negative", sql`${table.amountCents} >= 0`)
  })
);

export const challenges = pgTable(
  "challenges",
  {
    id: text("id").primaryKey(),
    creatorId: text("creator_id").notNull().references(() => appUsers.id),
    claim: text("claim").notNull(),
    resolutionCriteria: text("resolution_criteria").notNull(),
    resolutionTool: text("resolution_tool"),
    creatorSide: text("creator_side").notNull(),
    visibility: text("visibility").notNull().default("public"),
    stakeCents: integer("stake_cents").notNull(),
    matchedCents: integer("matched_cents").notNull().default(0),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    disputeDeadlineAt: timestamp("dispute_deadline_at"),
    provisionalOutcome: text("provisional_outcome"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (table) => ({
    statusIdx: index("idx_challenges_status").on(table.status),
    visibilityIdx: index("idx_challenges_visibility").on(table.visibility, table.createdAt),
    creatorSideCheck: check("challenge_creator_side_check", sql`${table.creatorSide} IN ('YES', 'NO')`),
    visibilityCheck: check("challenge_visibility_check", sql`${table.visibility} IN ('public', 'private')`),
    stakeNonNegative: check("challenge_stake_non_negative", sql`${table.stakeCents} >= 0`),
    matchedNonNegative: check("challenge_matched_non_negative", sql`${table.matchedCents} >= 0`),
    matchedWithinStake: check("challenge_matched_within_stake", sql`${table.matchedCents} <= ${table.stakeCents}`)
  })
);

export const challengeMatches = pgTable(
  "challenge_matches",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id").notNull().references(() => challenges.id),
    matcherId: text("matcher_id").notNull().references(() => appUsers.id),
    amountCents: integer("amount_cents").notNull(),
    side: text("side").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => ({
    challengeIdx: index("idx_matches_challenge").on(table.challengeId),
    sideCheck: check("match_side_check", sql`${table.side} IN ('YES', 'NO')`),
    amountPositive: check("match_amount_positive", sql`${table.amountCents} > 0`)
  })
);

export const resolutionRuns = pgTable(
  "resolution_runs",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id").notNull().references(() => challenges.id),
    exaQuery: text("exa_query").notNull(),
    sourceUrls: text("source_urls").notNull().default("[]"),
    aiRationale: text("ai_rationale").notNull(),
    proposedOutcome: text("proposed_outcome").notNull(),
    confidence: real("confidence").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => ({
    challengeIdx: index("idx_resolution_challenge").on(table.challengeId, table.createdAt)
  })
);

export const disputes = pgTable("disputes", {
  id: text("id").primaryKey(),
  challengeId: text("challenge_id").notNull().references(() => challenges.id),
  challengerId: text("challenger_id").notNull().references(() => appUsers.id),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  adminDecision: text("admin_decision"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at")
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => appUsers.id),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").notNull(),
    maxStakeCents: integer("max_stake_cents").notNull(),
    dailyStakeLimitCents: integer("daily_stake_limit_cents").notNull(),
    allowCategories: text("allow_categories").notNull().default("[]"),
    denyCategories: text("deny_categories").notNull().default("[]"),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => ({
    hashIdx: uniqueIndex("api_keys_key_hash_unique").on(table.keyHash)
  })
);
