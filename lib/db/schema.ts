import { pgTable, text, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";

// Site-wide configuration storage. Single key-value table — each row is one
// logical setting blob (e.g. key='site' holds the SEO/brand config). The
// JSONB value column is permitted under CLAUDE.md's exception for
// audit/metadata payloads — schema is validated at the application layer
// (Zod) rather than the DB layer for editing ergonomics.
//
// Naming follows CLAUDE.md standards: snake_case singular, UUID PK,
// created_at/updated_at on every row, FK indexes (none here — no FKs).

export const siteSetting = pgTable("site_setting", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Logical name for this row (e.g. 'site', 'profile', 'contact_form').
  // Upserts target this column.
  key: text("key").notNull().unique(),
  // The actual settings as a JSON document. Application layer validates shape.
  value: jsonb("value").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SiteSetting = typeof siteSetting.$inferSelect;
export type NewSiteSetting = typeof siteSetting.$inferInsert;
