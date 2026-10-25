// The news radar's labelling page. Server-renders the first load; the client
// list (components/admin/radar/radar-list.tsx) handles filters, labels and the
// "new items" poll through /api/admin/radar.
//
// Query string: ?view=to-label|shortlisted|kept|skipped|all &cohort=<version> &page=<n>
// Garbage in the URL falls back to the defaults instead of failing the page.

import { RadarList } from "../../../../../components/admin/radar/radar-list";
import { getDb } from "../../../../../lib/db";
import { loadRadarPage } from "../../../../../lib/news-radar/queries";
import {
  RADAR_VIEWS,
  type RadarPageData,
  type RadarView,
} from "../../../../../lib/news-radar/radar-page-types";

export const dynamic = "force-dynamic";

interface RadarPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const positiveInt = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

export default async function AdminBlogRadar({ searchParams }: RadarPageProps) {
  const sp = await searchParams;
  const rawView = first(sp.view);
  const view: RadarView = RADAR_VIEWS.includes(rawView as RadarView) ? (rawView as RadarView) : "to-label";

  let initial: RadarPageData | null = null;
  try {
    initial = await loadRadarPage(getDb(), {
      view,
      cohort: positiveInt(first(sp.cohort)),
      page: positiveInt(first(sp.page)),
    });
  } catch (err) {
    // The list shows "Couldn't load the radar." with a Retry; never the exception.
    console.error("[admin/blog/radar] load failed:", err instanceof Error ? err.name : "unknown");
  }

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-display-md text-ink">Radar</h1>
        <p className="mt-2 text-sm text-ink-subtle">
          News the model ranked for you. Label what you would write about; the scores stay
          hidden until you ask.
        </p>
      </div>
      <RadarList initial={initial} />
    </section>
  );
}
