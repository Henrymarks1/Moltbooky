CREATE TABLE "challenge_required_apps" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"app_slug" text NOT NULL,
	"app_name" text NOT NULL,
	"creator_connection_id" text,
	"opponent_connection_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "challenges" DROP CONSTRAINT "challenge_status_check";--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "kind" text DEFAULT 'open_match' NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "invited_opponent_id" text;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "challenge_required_apps" ADD CONSTRAINT "challenge_required_apps_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_required_apps" ADD CONSTRAINT "challenge_required_apps_creator_connection_id_pipedream_connections_id_fk" FOREIGN KEY ("creator_connection_id") REFERENCES "public"."pipedream_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_required_apps" ADD CONSTRAINT "challenge_required_apps_opponent_connection_id_pipedream_connections_id_fk" FOREIGN KEY ("opponent_connection_id") REFERENCES "public"."pipedream_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_required_apps_challenge_app_unique" ON "challenge_required_apps" USING btree ("challenge_id","app_slug");--> statement-breakpoint
CREATE INDEX "idx_challenge_required_apps_challenge" ON "challenge_required_apps" USING btree ("challenge_id");--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_invited_opponent_id_app_users_id_fk" FOREIGN KEY ("invited_opponent_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenge_kind_check" CHECK ("challenges"."kind" IN ('open_match', 'head_to_head'));--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenge_status_check" CHECK ("challenges"."status" IN ('open', 'pending_acceptance', 'resolving', 'provisional_resolved', 'final_resolved', 'cancelled', 'expired_unmatched', 'voided', 'disputed'));