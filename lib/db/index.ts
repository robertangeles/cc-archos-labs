import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Lazy DB client. Validation runs on first call so module load doesn't
// crash builds in env-less environments. Single connection (max: 1)
// because Next.js spins up ephemeral request handlers — pooling at the
// DB layer would just create connection storms. Render Postgres handles
// connection re-use at the platform level via PgBouncer-style pooling.

let cachedDb: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (cachedDb) return cachedDb;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (see .env.example) " +
        "or to the Render service env vars in production.",
    );
  }

  // Render Postgres requires SSL; postgres.js doesn't auto-detect from
  // the URL alone. Setting ssl explicitly so this works for both the
  // External Database URL (local dev) and the Internal one (Render).
  const client = postgres(databaseUrl, { max: 1, ssl: "require" });
  cachedDb = drizzle(client, {
    schema,
    logger: process.env.NODE_ENV === "development",
  });
  return cachedDb;
}

export type DB = ReturnType<typeof getDb>;
