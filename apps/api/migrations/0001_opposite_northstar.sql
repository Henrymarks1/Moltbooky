ALTER TABLE "challenges" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_challenges_visibility" ON "challenges" USING btree ("visibility","created_at");--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenge_visibility_check" CHECK ("challenges"."visibility" IN ('public', 'private'));
