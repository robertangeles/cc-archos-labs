// The drafting pipeline's settings and its on switch. Both are site_setting rows,
// so they change without a deploy; neither has an admin screen yet.
//
//   news_draft_enabled  {"enabled": true}  OFF unless exactly this. Absent or
//                       malformed means off: a bad switch must never start paid work.
//   news_draft_config   optional overrides of DEFAULT_DRAFT_CONFIG. A row that does
//                       not parse is an error, not a silent fallback: quietly using
//                       the defaults when someone configured something else would run
//                       paid work in a way they did not choose.

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../../db";
import { siteSetting } from "../../db/schema";

export const DRAFT_FLAG_KEY = "news_draft_enabled";
export const DRAFT_CONFIG_KEY = "news_draft_config";

export interface DraftConfig {
  /** Jobs that may START per Melbourne day. */
  dailyCap: number;
  /** Rewrite rounds the tighten loop may spend per post. */
  maxRewrites: number;
  /** Target length of the essay, in words. */
  targetWords: number;
  /** Source pages fetched per story. */
  maxSources: number;
  /** Tries per job; a restart begins again at the first stage. */
  maxAttempts: number;
  /** How long a run may hold a job before another may take it. */
  leaseMinutes: number;
  /** Declared to sources that ask who is fetching (the SEC does). */
  contactEmail: string;
  /** Category slug and author name a draft is filed under. */
  categorySlug: string;
  authorName: string;
  models: {
    search: string;
    writer: string;
    judge: string;
    photoBrief: string;
    image: string;
  };
}

export const DEFAULT_DRAFT_CONFIG: DraftConfig = {
  dailyCap: 3,
  maxRewrites: 3,
  targetWords: 900,
  maxSources: 5,
  maxAttempts: 2,
  leaseMinutes: 20,
  contactEmail: "rob.angeles@archoslabs.xyz",
  categorySlug: "ai-news",
  authorName: "Metis",
  models: {
    search: "perplexity/sonar-pro",
    writer: "anthropic/claude-sonnet-5.5",
    judge: "deepseek/deepseek-v4-flash-0731",
    photoBrief: "anthropic/claude-haiku-4.5",
    image: "bytedance-seed/seedream-5-0-pro",
  },
};

/** The stored config does not parse. */
export class DraftConfigError extends Error {
  override name = "DraftConfigError";
}

const Model = z.string().min(1).max(100);

// strictObject: an unknown key is a typo, and a typo must not do nothing quietly.
const Overrides = z.strictObject({
  dailyCap: z.number().int().min(1).max(10),
  maxRewrites: z.number().int().min(0).max(3),
  targetWords: z.number().int().min(400).max(1500),
  maxSources: z.number().int().min(1).max(8),
  maxAttempts: z.number().int().min(1).max(3),
  leaseMinutes: z.number().int().min(5).max(60),
  contactEmail: z.email().max(254),
  categorySlug: z.string().min(1).max(100),
  authorName: z.string().min(1).max(100),
  models: z.strictObject({
    search: Model,
    writer: Model,
    judge: Model,
    photoBrief: Model,
    image: Model,
  }).partial(),
}).partial();

export function parseDraftConfig(raw: unknown): DraftConfig {
  const parsed = Overrides.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DraftConfigError(`news_draft_config is not valid: ${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "bad shape"}`);
  }
  const { models, ...rest } = parsed.data;
  return { ...DEFAULT_DRAFT_CONFIG, ...rest, models: { ...DEFAULT_DRAFT_CONFIG.models, ...models } };
}

export async function getDraftConfig(db: DB): Promise<DraftConfig> {
  const rows = await db.select({ value: siteSetting.value }).from(siteSetting).where(eq(siteSetting.key, DRAFT_CONFIG_KEY)).limit(1);
  return rows.length === 0 ? DEFAULT_DRAFT_CONFIG : parseDraftConfig(rows[0].value);
}

export async function isDraftEnabled(db: DB): Promise<boolean> {
  const rows = await db.select({ value: siteSetting.value }).from(siteSetting).where(eq(siteSetting.key, DRAFT_FLAG_KEY)).limit(1);
  const stored = rows[0]?.value as { enabled?: unknown } | null | undefined;
  return stored?.enabled === true;
}
