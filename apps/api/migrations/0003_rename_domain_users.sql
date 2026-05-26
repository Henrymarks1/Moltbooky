ALTER TABLE "users" RENAME TO "app_users";--> statement-breakpoint
ALTER INDEX "users_email_unique" RENAME TO "app_users_email_unique";--> statement-breakpoint
ALTER TABLE "api_keys" RENAME CONSTRAINT "api_keys_user_id_users_id_fk" TO "api_keys_user_id_app_users_id_fk";--> statement-breakpoint
ALTER TABLE "challenge_matches" RENAME CONSTRAINT "challenge_matches_matcher_id_users_id_fk" TO "challenge_matches_matcher_id_app_users_id_fk";--> statement-breakpoint
ALTER TABLE "challenges" RENAME CONSTRAINT "challenges_creator_id_users_id_fk" TO "challenges_creator_id_app_users_id_fk";--> statement-breakpoint
ALTER TABLE "disputes" RENAME CONSTRAINT "disputes_challenger_id_users_id_fk" TO "disputes_challenger_id_app_users_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_entries" RENAME CONSTRAINT "ledger_entries_user_id_users_id_fk" TO "ledger_entries_user_id_app_users_id_fk";--> statement-breakpoint
ALTER TABLE "wallet_accounts" RENAME CONSTRAINT "wallet_accounts_user_id_users_id_fk" TO "wallet_accounts_user_id_app_users_id_fk";
