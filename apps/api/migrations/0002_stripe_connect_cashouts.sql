ALTER TABLE "users" ADD COLUMN "stripe_connect_account_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_connect_payouts_enabled" boolean DEFAULT false NOT NULL;
