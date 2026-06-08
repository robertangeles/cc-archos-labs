import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Logger } from "drizzle-orm/logger";
import postgres from "postgres";
import * as schema from "./schema";

// Lazy DB client. Validation runs on first call so module load doesn't
// crash builds in env-less environments. Single connection (max: 1)
// because Next.js spins up ephemeral request handlers — pooling at the
// DB layer would just create connection storms. Render Postgres handles
// connection re-use at the platform level via PgBouncer-style pooling.

const REDACTED_KEYS = ["llmApiKey", "resendApiKey", "adminPassword", "turnstileSecretKey", "googleOauthClientSecret"];
const PARAM_TRUNCATE_LEN = 120;

class SafeLogger implements Logger {
  logQuery(query: string, params: unknown[]) {
    const safe = params.map((p) => {
      if (typeof p !== "string") return p;
      for (const key of REDACTED_KEYS) {
        if (p.includes(`"${key}"`)) return "[REDACTED integration_secrets]";
      }
      if (p.length > PARAM_TRUNCATE_LEN) {
        return p.slice(0, PARAM_TRUNCATE_LEN) + `…[${p.length} chars]`;
      }
      return p;
    });
    console.log("Query:", query, "-- params:", JSON.stringify(safe));
  }
}

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
    logger: process.env.NODE_ENV === "development" ? new SafeLogger() : false,
  });
  return cachedDb;
}

export type DB = ReturnType<typeof getDb>;
