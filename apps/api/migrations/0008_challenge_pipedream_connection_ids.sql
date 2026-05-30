ALTER TABLE "challenges" ADD COLUMN IF NOT EXISTS "pipedream_connection_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL;
ALTER TABLE "challenges" DROP COLUMN IF EXISTS "draft_data";
