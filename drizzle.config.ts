import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./packages/db/src/db/schema.ts",
  out: "./apps/api/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ""
  }
});
