import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { siteSetting } from "../db/schema";
import { CdmpConfigSchema, type CdmpConfig } from "./config-shared";

export const SITE_SETTING_KEY = "cdmp_config";

export const getCdmpConfig = cache(async (): Promise<CdmpConfig> => {
  const db = getDb();
  const rows = await db
    .select({ value: siteSetting.value })
    .from(siteSetting)
    .where(eq(siteSetting.key, SITE_SETTING_KEY))
    .limit(1);

  if (rows.length === 0) {
    throw new Error(
      "CDMP config not found. Run `pnpm db:seed-cdmp-config` or configure it in /admin/cdmp.",
    );
  }

  const parsed = CdmpConfigSchema.safeParse(rows[0].value);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((i) => i.path.join("."))
      .join(", ");
    throw new Error(
      `Stored CDMP config failed validation (fields: ${fields}). Re-save it in /admin/cdmp.`,
    );
  }
  return parsed.data;
});
