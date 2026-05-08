import type { Config } from "drizzle-kit";

// drizzle-kit reads DATABASE_URL from the process env. Use:
//   pnpm db:push    (loads .env.local via --env-file)
//   pnpm db:studio  (same)
// On Render the env var is injected by the platform.

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
    ssl: { rejectUnauthorized: false },
  },
  verbose: true,
  strict: false,
} satisfies Config;
