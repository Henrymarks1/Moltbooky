CREATE TABLE "resolution_events" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"run_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"metadata" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resolution_events" ADD CONSTRAINT "resolution_events_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_resolution_events_challenge" ON "resolution_events" USING btree ("challenge_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_resolution_events_run" ON "resolution_events" USING btree ("run_id","created_at");