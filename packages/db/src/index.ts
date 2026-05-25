import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./db/schema";

export * from "./db/schema";
export { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
export { schema };

export function createDb(databaseUrl: string) {
  return drizzle(new Pool({ connectionString: databaseUrl }), { schema });
}

export type Db = ReturnType<typeof createDb>;
