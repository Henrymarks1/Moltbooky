import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./db/schema";

export * from "./db/schema";
export { schema };

export function createDb(databaseUrl: string) {
  return drizzle(neon(databaseUrl), { schema });
}

export type Db = ReturnType<typeof createDb>;
