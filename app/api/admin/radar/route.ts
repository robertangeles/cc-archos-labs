import { z } from "zod";
import { getDb } from "../../../../lib/db";
import { loadRadarPage, loadRadarSummary } from "../../../../lib/news-radar/queries";
import { RADAR_VIEWS } from "../../../../lib/news-radar/radar-page-types";

export const runtime = "nodejs";

// GET /api/admin/radar?view=to-label|shortlisted|kept|skipped|all&cohort=<n>&page=<n>
//   The Radar page's data (RadarPageData). All views are one cohort; only `all`
//   paginates (`page`).
// GET /api/admin/radar?summary=1&since=<ISO instant>
//   The cheap poll behind "3 new . Refresh" (RadarSummary).
//
// Gated by proxy.ts: every /api/admin/** path needs a signed-in admin session.

// At most 9 digits, so a cohort or page always fits Postgres integer.
const positiveInt = z
  .string()
  .regex(/^[1-9]\d{0,8}$/)
  .transform(Number);

const Query = z
  .object({
    view: z.enum(RADAR_VIEWS).default("to-label"),
    cohort: positiveInt.optional(),
    page: positiveInt.optional(),
    summary: z.literal("1").optional(),
    since: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((q) => q.summary === undefined || q.since !== undefined, {
    path: ["since"],
    error: "since is required with summary",
  });

export async function GET(request: Request) {
  const parsed = Query.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: `${parsed.error.issues[0]?.path.join(".") || "query"}: invalid.` },
      { status: 400 },
    );
  }

  const { view, cohort, page, summary, since } = parsed.data;
  try {
    const db = getDb();
    return Response.json(
      summary && since
        ? await loadRadarSummary(db, new Date(since))
        : await loadRadarPage(db, { view, cohort, page }),
    );
  } catch (err) {
    // Name only: a database error message can carry connection details.
    console.error("[admin/radar] load failed:", err instanceof Error ? err.name : "UnknownError");
    return Response.json({ ok: false, error: "Couldn't load the radar." }, { status: 500 });
  }
}
