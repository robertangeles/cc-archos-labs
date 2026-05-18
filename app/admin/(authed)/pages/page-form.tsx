"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  AdminPageView,
  BlockInputView,
} from "../../../../lib/pages/types";
import { CONTENT_MD_MAX_BYTES } from "../../../../lib/pages/schema";
import { BlocksEditor } from "./blocks-editor";

// Shared form for both create and edit. Mode is derived from whether
// `initial` is provided. On save: POST to /api/admin/pages (create) or
// PUT to /api/admin/pages/[id] (update with optimistic-lock).
//
// LoadStatus / SaveStatus pattern mirrors /admin/site for visual
// consistency. The optional staleUpdatedAt prop handles the 409
// concurrent-edit case: we display a banner with "Reload" rather than
// silently overwriting.

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string }
  | { kind: "stale"; currentUpdatedAt: string };

interface PageFormProps {
  initial?: AdminPageView;
  /** Phase 2: blocks pre-loaded server-side for composed pages. Empty
   *  array for long_form pages or new (unsaved) pages. */
  initialBlocks?: BlockInputView[];
}

const inputClass =
  "w-full rounded-md border border-hairline bg-canvas px-4 py-3 text-base text-ink placeholder:text-ink-subtle/60 transition-all duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40";

const labelClass =
  "text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle";

// SERP soft limits — what Google typically truncates at. Hard limits
// (in Zod + the maxLength attr) live higher so users have flex for
// rich-result variants, but the counter goes amber past the soft limit
// to nudge toward "Google will actually show this much."
const SEO_TITLE_SOFT_LIMIT = 60;
const SEO_DESC_SOFT_LIMIT = 160;

export function PageForm({ initial, initialBlocks = [] }: PageFormProps) {
  const router = useRouter();
  const isEdit = initial !== undefined;

  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [contentMd, setContentMd] = useState(initial?.contentMd ?? "");
  const [excerpt, setExcerpt] = useState(initial?.excerpt ?? "");
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(
    initial?.seoDescription ?? "",
  );
  const [ogType, setOgType] = useState<"article" | "website">(
    initial?.ogType ?? "article",
  );
  const [status, setStatus] = useState<"draft" | "published">(
    initial?.status === "archived" ? "draft" : (initial?.status ?? "draft"),
  );
  const [template, setTemplate] = useState<"long_form" | "composed">(
    initial?.template === "composed" ? "composed" : "long_form",
  );
  const [blocks, setBlocks] = useState<BlockInputView[]>(initialBlocks);
  const [lastReviewedAt, setLastReviewedAt] = useState(
    initial?.lastReviewedAt
      ? new Date(initial.lastReviewedAt).toISOString().slice(0, 10)
      : "",
  );

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveStatus({ kind: "saving" });

    const body = {
      slug,
      title,
      contentMd,
      excerpt: excerpt || null,
      seoTitle: seoTitle || null,
      seoDescription: seoDescription || null,
      ogType,
      status,
      template,
      lastReviewedAt: lastReviewedAt ? new Date(lastReviewedAt).toISOString() : null,
      // Only send blocks when composed. Server discards them when
      // long_form anyway, but keeping the payload tight is cheaper.
      ...(template === "composed"
        ? {
            blocks: blocks.map((b, idx) => ({
              blockType: b.blockType,
              position: idx,
              props: b.props,
            })),
          }
        : {}),
      ...(isEdit
        ? { expectedUpdatedAt: new Date(initial!.updatedAt).toISOString() }
        : {}),
    };

    try {
      const url = isEdit ? `/api/admin/pages/${initial!.id}` : "/api/admin/pages";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (res.status === 409 && json.reason === "stale_updated_at") {
        setSaveStatus({
          kind: "stale",
          currentUpdatedAt: json.currentUpdatedAt,
        });
        return;
      }
      if (!res.ok || !json.ok) {
        setSaveStatus({
          kind: "error",
          message: json.error ?? "Save failed.",
        });
        return;
      }

      setSaveStatus({ kind: "saved" });
      if (!isEdit) {
        router.push(`/admin/pages/${json.data.id}`);
      } else {
        router.refresh();
        setTimeout(() => setSaveStatus({ kind: "idle" }), 1500);
      }
    } catch {
      setSaveStatus({ kind: "error", message: "Network error — try again." });
    }
  }

  const bytesUsed = new TextEncoder().encode(contentMd).length;
  const bytesOver = bytesUsed > CONTENT_MD_MAX_BYTES;

  return (
    <form onSubmit={onSave} className="space-y-8">
      {saveStatus.kind === "stale" ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          <p className="font-semibold">Someone else saved this page.</p>
          <p className="mt-1">
            The page was modified at {saveStatus.currentUpdatedAt}. Reload to
            see their changes, or save anyway to overwrite them.
          </p>
          <div className="mt-3 flex gap-x-3">
            <button
              type="button"
              onClick={() => router.refresh()}
              className="text-primary hover:underline"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => setSaveStatus({ kind: "idle" })}
              className="text-ink-subtle hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-x-6 gap-y-6 md:grid-cols-2">
        <div>
          <label className={labelClass}>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`${inputClass} mt-2`}
            placeholder="Privacy Policy"
            required
            maxLength={200}
          />
        </div>
        <div>
          <label className={labelClass}>Slug</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className={`${inputClass} mt-2 font-mono text-sm`}
            placeholder="privacy"
            required
            maxLength={80}
            pattern="[a-z0-9][a-z0-9-]*[a-z0-9]?"
            title="Lower-case kebab-case (letters, digits, hyphens)"
          />
          <p className="mt-2 text-[12px] text-ink-subtle">
            Public URL will be /{slug || "<slug>"}
          </p>
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-6 md:grid-cols-2">
        <div>
          <label className={labelClass}>Template</label>
          <select
            value={template}
            onChange={(e) =>
              setTemplate(e.target.value as "long_form" | "composed")
            }
            className={`${inputClass} mt-2`}
          >
            <option value="long_form">Long-form (markdown)</option>
            <option value="composed">Composed (section blocks)</option>
          </select>
          <p className="mt-2 text-[12px] text-ink-subtle">
            Long-form = single markdown body (legal, prose). Composed =
            assemble the page from Hero, Proof grid, Service grid, CTA,
            and Markdown blocks.
          </p>
        </div>
        <div className="md:col-start-2">
          {/* spacer; status moves into next grid row */}
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-6 md:grid-cols-3">
        <div>
          <label className={labelClass}>Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "draft" | "published")}
            className={`${inputClass} mt-2`}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>OG type</label>
          <select
            value={ogType}
            onChange={(e) =>
              setOgType(e.target.value as "article" | "website")
            }
            className={`${inputClass} mt-2`}
          >
            <option value="article">Article (legal, long-form)</option>
            <option value="website">Website (marketing landing)</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Last reviewed</label>
          <input
            type="date"
            value={lastReviewedAt}
            onChange={(e) => setLastReviewedAt(e.target.value)}
            className={`${inputClass} mt-2`}
          />
          <p className="mt-2 text-[12px] text-ink-subtle">
            Used in the &ldquo;last updated&rdquo; stamp on the public page.
          </p>
        </div>
      </div>

      <div>
        <FieldHeader
          label="Summary"
          count={excerpt.length}
          softLimit={SEO_DESC_SOFT_LIMIT}
        />
        <textarea
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          className={`${inputClass} mt-2 min-h-[80px]`}
          placeholder="1-2 sentence summary. Used as the meta description fallback (Google truncates around 160 chars) and surfaced on hover previews + landing-page teasers in later phases."
          maxLength={500}
        />
      </div>

      <div className="space-y-6">
        <div>
          <FieldHeader
            label="SEO title (override)"
            count={seoTitle.length}
            softLimit={SEO_TITLE_SOFT_LIMIT}
          />
          <input
            type="text"
            value={seoTitle}
            onChange={(e) => setSeoTitle(e.target.value)}
            className={`${inputClass} mt-2`}
            placeholder="Optional — falls back to the title above"
            maxLength={80}
          />
          <p className="mt-2 text-[11px] text-ink-subtle">
            Google truncates around 60 characters; up to 80 allowed for
            flexibility.
          </p>
        </div>
        <div>
          <FieldHeader
            label="SEO description (override)"
            count={seoDescription.length}
            softLimit={SEO_DESC_SOFT_LIMIT}
          />
          <textarea
            value={seoDescription}
            onChange={(e) => setSeoDescription(e.target.value)}
            className={`${inputClass} mt-2 min-h-[80px]`}
            placeholder="Optional — falls back to the summary above, then to the site default"
            maxLength={300}
          />
          <p className="mt-2 text-[11px] text-ink-subtle">
            Google truncates around 160 characters; up to 300 allowed for
            flexibility.
          </p>
        </div>
      </div>

      {template === "long_form" ? (
        <div>
          <div className="flex items-baseline justify-between">
            <label className={labelClass}>Content (markdown)</label>
            <span
              className={`text-[11px] tabular-nums ${
                bytesOver ? "text-red-500" : "text-ink-subtle"
              }`}
            >
              {bytesUsed.toLocaleString()} /{" "}
              {CONTENT_MD_MAX_BYTES.toLocaleString()} bytes
            </span>
          </div>
          <textarea
            value={contentMd}
            onChange={(e) => setContentMd(e.target.value)}
            className={`${inputClass} mt-2 min-h-[500px] font-mono text-sm`}
            placeholder="# Heading\n\nParagraph..."
          />
          <p className="mt-2 text-[12px] text-ink-subtle">
            Markdown only — GitHub-flavoured tables and footnotes supported.
            HTML tags are escaped (XSS posture).
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-hairline bg-surface-1 p-6">
          <p className="mb-4 text-[12px] text-ink-subtle">
            This page is <strong className="text-ink">composed</strong> from
            section blocks. The markdown body above is ignored when the
            template is composed. Switch the template back to long-form to
            edit markdown again.
          </p>
          <BlocksEditor
            pageId={initial?.id}
            initial={blocks}
            onChange={setBlocks}
          />
        </div>
      )}

      <div className="flex items-center justify-between border-t border-hairline pt-6">
        <SaveStatusLabel status={saveStatus} />
        <button
          type="submit"
          disabled={saveStatus.kind === "saving" || bytesOver}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-canvas hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saveStatus.kind === "saving"
            ? "Saving…"
            : isEdit
              ? "Save changes"
              : "Create page"}
        </button>
      </div>
    </form>
  );
}

function SaveStatusLabel({ status }: { status: SaveStatus }) {
  switch (status.kind) {
    case "idle":
      return null;
    case "saving":
      return <span className="text-sm text-ink-subtle">Saving…</span>;
    case "saved":
      return (
        <span className="text-sm text-emerald-600 dark:text-emerald-400">
          ✓ Saved · new revision created
        </span>
      );
    case "error":
      return (
        <span className="text-sm text-red-500" role="alert">
          {status.message}
        </span>
      );
    case "stale":
      return null; // handled by banner above
  }
}

// Label + character counter row used for fields with a SERP soft limit.
// The counter goes amber past the soft limit but the underlying maxLength
// allows over-typing — users sometimes have a reason to exceed.
function FieldHeader({
  label,
  count,
  softLimit,
}: {
  label: string;
  count: number;
  softLimit: number;
}) {
  const over = count > softLimit;
  return (
    <div className="flex items-baseline justify-between">
      <label className={labelClass}>{label}</label>
      <span
        className={`text-[11px] tabular-nums ${
          over ? "text-amber-600 dark:text-amber-400" : "text-ink-subtle"
        }`}
      >
        {count} / {softLimit} chars
      </span>
    </div>
  );
}
