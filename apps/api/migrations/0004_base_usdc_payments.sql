CREATE TABLE "user_payment_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"privy_user_id" text,
	"withdrawal_address" text,
	"deposit_wallet_id" text,
	"deposit_address" text,
	"chain" text DEFAULT 'base' NOT NULL,
	"last_scanned_block" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crypto_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"user_id" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer DEFAULT 0 NOT NULL,
	"amount_micro_usdc" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"provider_ref" text,
	"block_number" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "crypto_transactions_direction_check" CHECK ("crypto_transactions"."direction" IN ('deposit', 'withdrawal')),
	CONSTRAINT "crypto_transactions_status_check" CHECK ("crypto_transactions"."status" IN ('pending', 'confirmed', 'failed')),
	CONSTRAINT "crypto_transactions_amount_non_negative" CHECK ("crypto_transactions"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user_payment_profiles" ADD CONSTRAINT "user_payment_profiles_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crypto_transactions" ADD CONSTRAINT "crypto_transactions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_payment_profiles_deposit_address_unique" ON "user_payment_profiles" USING btree ("deposit_address");
--> statement-breakpoint
CREATE INDEX "idx_user_payment_profiles_withdrawal" ON "user_payment_profiles" USING btree ("withdrawal_address");
--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_transactions_tx_log_unique" ON "crypto_transactions" USING btree ("tx_hash","log_index");
--> statement-breakpoint
CREATE INDEX "idx_crypto_transactions_user" ON "crypto_transactions" USING btree ("user_id","created_at");
--> statement-breakpoint
ALTER TABLE "app_users" DROP COLUMN IF EXISTS "stripe_connect_account_id";
--> statement-breakpoint
ALTER TABLE "app_users" DROP COLUMN IF EXISTS "stripe_connect_payouts_enabled";
