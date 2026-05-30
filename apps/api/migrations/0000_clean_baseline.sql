CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"beta_status" text DEFAULT 'invited' NOT NULL,
	"kyc_status" text DEFAULT 'not_started' NOT NULL,
	"compliance_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"available_cents" integer DEFAULT 0 NOT NULL,
	"locked_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_account_available_non_negative" CHECK ("credit_accounts"."available_cents" >= 0),
	CONSTRAINT "credit_account_locked_non_negative" CHECK ("credit_accounts"."locked_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pipedream_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"app_slug" text NOT NULL,
	"app_name" text NOT NULL,
	"account_id" text NOT NULL,
	"auth_prop_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"challenge_id" text,
	"match_id" text,
	"idempotency_key" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"claim" text NOT NULL,
	"resolution_criteria" text NOT NULL,
	"resolution_tool" text,
	"pipedream_connection_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"creator_side" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"stake_cents" integer NOT NULL,
	"matched_cents" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"dispute_deadline_at" timestamp,
	"provisional_outcome" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_creator_side_check" CHECK ("challenges"."creator_side" IN ('YES', 'NO')),
	CONSTRAINT "challenge_status_check" CHECK ("challenges"."status" IN ('open', 'resolving', 'provisional_resolved', 'final_resolved', 'cancelled', 'expired_unmatched', 'voided', 'disputed')),
	CONSTRAINT "challenge_visibility_check" CHECK ("challenges"."visibility" IN ('public', 'private')),
	CONSTRAINT "challenge_stake_non_negative" CHECK ("challenges"."stake_cents" >= 0),
	CONSTRAINT "challenge_matched_non_negative" CHECK ("challenges"."matched_cents" >= 0),
	CONSTRAINT "challenge_matched_within_stake" CHECK ("challenges"."matched_cents" <= "challenges"."stake_cents")
);
--> statement-breakpoint
CREATE TABLE "challenge_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"matcher_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"side" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "match_side_check" CHECK ("challenge_matches"."side" IN ('YES', 'NO')),
	CONSTRAINT "match_amount_positive" CHECK ("challenge_matches"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "resolution_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"exa_query" text NOT NULL,
	"source_urls" text DEFAULT '[]' NOT NULL,
	"ai_rationale" text NOT NULL,
	"proposed_outcome" text NOT NULL,
	"confidence" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"challenger_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"admin_decision" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text NOT NULL,
	"max_stake_cents" integer NOT NULL,
	"daily_stake_limit_cents" integer NOT NULL,
	"allow_categories" text DEFAULT '[]' NOT NULL,
	"deny_categories" text DEFAULT '[]' NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pipedream_connections" ADD CONSTRAINT "pipedream_connections_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_creator_id_app_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "challenge_matches" ADD CONSTRAINT "challenge_matches_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "challenge_matches" ADD CONSTRAINT "challenge_matches_matcher_id_app_users_id_fk" FOREIGN KEY ("matcher_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "resolution_runs" ADD CONSTRAINT "resolution_runs_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_challenger_id_app_users_id_fk" FOREIGN KEY ("challenger_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_email_unique" ON "app_users" USING btree ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX "pipedream_connections_user_app_unique" ON "pipedream_connections" USING btree ("user_id","app_slug");
--> statement-breakpoint
CREATE INDEX "idx_pipedream_connections_user" ON "pipedream_connections" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_ledger_user" ON "ledger_entries" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_unique" ON "ledger_entries" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "idx_challenges_status" ON "challenges" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_challenges_visibility" ON "challenges" USING btree ("visibility","created_at");
--> statement-breakpoint
CREATE INDEX "idx_matches_challenge" ON "challenge_matches" USING btree ("challenge_id");
--> statement-breakpoint
CREATE INDEX "idx_resolution_challenge" ON "resolution_runs" USING btree ("challenge_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_unique" ON "api_keys" USING btree ("key_hash");
