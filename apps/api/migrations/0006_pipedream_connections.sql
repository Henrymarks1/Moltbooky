CREATE TABLE IF NOT EXISTS "pipedream_connections" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "app_slug" text NOT NULL,
  "app_name" text NOT NULL,
  "account_id" text NOT NULL,
  "auth_prop_name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "pipedream_connections_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pipedream_connections_user_app_unique" ON "pipedream_connections" ("user_id","app_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pipedream_connections_user" ON "pipedream_connections" ("user_id");
