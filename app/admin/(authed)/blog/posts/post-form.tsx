"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useRef, useState } from "react";
// (useRef stays — used for the textarea handle for cursor-insertion)
import { computeLinkInsertion } from "../../../../../lib/blog-editor/insert-link";
import {
  formatMelbourneForHumans,
  melbourneParts,
  melbourneTzAbbrev,
  melbourneWallToUtcIso,
  splitMelbourneDatetime,
} from "../../../../../lib/format-melbourne";
import { CONTENT_MD_MAX_BYTES } from "../../../../../lib/posts-admin/schema";
import type {
  AdminPostView,
  AuthorLookup,
  CategoryLookup,
  PostStatus,
  PostVisibility,
} from "../../../../../lib/posts-admin/types";
import { LinkSuggestionsDrawer } from "./link-suggestions-drawer";
import { PreviewPane } from "./preview-pane";
import { DateField } from "@/components/ui/date-field";

// Shared form for both create + edit. Mode is derived from whether
// `initial` is provided. On save: POST to /api/admin/posts (create) or
// PUT to /api/admin/posts/[id] (update with optimistic-lock).
//
// Layout:
//   ┌─────────────────────────────────────────────────────────┐
//   │ Stale-edit banner (only on 409)                         │
//   │ Status / Save toast row                                 │
//   │ Title │ Slug                                            │
//   │ Status │ Visibility │ Scheduled-at (when status=sched)  │
//   │ Category │ Author │ Tags                                │
//   │ Excerpt                                                 │
//   │ Content (textarea) │ Live preview (split-pane)          │
//   │ SEO title / description                                 │
//   │ AI-assist + Mark reviewed                               │
//   │ Save / Cancel                                            │
//   └─────────────────────────────────────────────────────────┘
// LinkSuggestionsDrawer is mounted overlay when its `open` flag flips.

type SideEffectSummary = {
  ogRegenerated: "ok" | "failed" | "skipped";
  embeddingRegenerated: "ok" | "failed" | "skipped";
  ogError?: string;
  embeddingError?: string;
};

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; sideEffects?: SideEffectSummary }
  | { kind: "error"; message: string }
  | { kind: "stale"; currentUpdatedAt: string };

type AiActionStatus =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

interface PostFormProps {
  initial?: AdminPostView;
  authors: AuthorLookup[];
  categories: CategoryLookup[];
}

const inputClass =
  "w-full rounded-md border border-hairline bg-canvas px-4 py-3 text-base text-ink placeholder:text-ink-subtle/60 transition-all duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40";

const labelClass =
  "text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle";

const SEO_TITLE_SOFT_LIMIT = 60;
// Client-side sanity ceiling on the original upload. The server auto-
// compresses anything that exceeds the 500 KB DB cap via
// lib/image-pipeline.ts, so the client only blocks pathological inputs.
const IMAGE_MAX_KB = 10 * 1024;
// Soft-warn threshold against the FINAL (post-compression) size. If the
// server resize ladder kicks in and the output still lands above 150 KB,
// the user gets an amber nudge — but the upload succeeded.
const IMAGE_SOFT_WARN_KB = 150;
const ALT_MAX_LEN = 125;
const SEO_DESC_SOFT_LIMIT = 160;

export function PostForm({ initial, authors, categories }: PostFormProps) {
  const router = useRouter();
  const isEdit = initial !== undefined;

  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [excerpt, setExcerpt] = useState(initial?.excerpt ?? "");
  const [contentMd, setContentMd] = useState(initial?.contentMd ?? "");
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(
    initial?.seoDescription ?? "",
  );
  const [authorId, setAuthorId] = useState<string>(initial?.authorId ?? "");
  const [categoryId, setCategoryId] = useState<string>(
    initial?.categoryId ?? "",
  );
  const [tagsText, setTagsText] = useState<string>(
    (initial?.tags ?? []).join(", "),
  );
  // Status defaults: new posts → draft; existing archived posts → draft
  // (you can't save archived from the form — use Restore via list).
  const [status, setStatus] = useState<Exclude<PostStatus, "archived">>(
    initial?.status === "archived"
      ? "draft"
      : (initial?.status as Exclude<PostStatus, "archived">) ?? "draft",
  );
  const [visibility, setVisibility] = useState<PostVisibility>(
    initial?.visibility ?? "listed",
  );
  // Schedule is ALWAYS interpreted in Australia/Melbourne. Split into
  // separate <input type="date"> + <input type="time"> instead of the
  // native datetime-local — date + time inputs have reliable calendar +
  // time pickers in every browser (datetime-local does not — Safari
  // and some Chromium configs render it as a bare text field).
  const initialSplit = splitMelbourneDatetime(initial?.scheduledPublishAt ?? null);
  const [scheduledDate, setScheduledDate] = useState<string>(initialSplit.date);
  const [scheduledTime, setScheduledTime] = useState<string>(initialSplit.time);
  const [needsReview, setNeedsReview] = useState<boolean>(
    initial?.needsReview ?? false,
  );

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [imageStatus, setImageStatus] = useState<AiActionStatus>({
    kind: "idle",
  });
  const [reviewedStatus, setReviewedStatus] = useState<AiActionStatus>({
    kind: "idle",
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Featured image state — held locally so upload/remove updates the
  // preview without a router refresh. Also tracks updatedAt because
  // upload/remove bumps post.updated_at on the server; the form's
  // optimistic-lock anchor needs to stay in sync.
  //
  // Soft-delete handling: when og_image_deleted_at is set on the
  // initial post, treat the image as absent in the UI (Upload button
  // instead of preview). Re-uploading clears deleted_at via the route.
  const hasInitialImage = Boolean(
    initial?.ogImagePath && !initial?.ogImageDeletedAt,
  );
  const [ogImagePath, setOgImagePath] = useState<string | null>(
    hasInitialImage ? (initial?.ogImagePath ?? null) : null,
  );
  const [ogImageAlt, setOgImageAlt] = useState<string>(
    initial?.ogImageAlt ?? "",
  );
  const [ogImageWidth, setOgImageWidth] = useState<number | null>(
    hasInitialImage ? (initial?.ogImageWidth ?? null) : null,
  );
  const [ogImageHeight, setOgImageHeight] = useState<number | null>(
    hasInitialImage ? (initial?.ogImageHeight ?? null) : null,
  );
  const [ogImageFilename, setOgImageFilename] = useState<string | null>(
    hasInitialImage ? (initial?.ogImageFilename ?? null) : null,
  );
  const [ogImageSizeKb, setOgImageSizeKb] = useState<number | null>(
    hasInitialImage ? (initial?.ogImageSizeKb ?? null) : null,
  );
  const [lastKnownUpdatedAt, setLastKnownUpdatedAt] = useState<Date>(
    initial?.updatedAt ?? new Date(),
  );

  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const deferredContent = useDeferredValue(contentMd);
  // Snapshot of the textarea's last known cursor position. Updated on
  // every onSelect + onBlur, read by insertLinkAtCursor when the user
  // triggers an insert from a non-textarea control (the drawer button,
  // typically). Without this snapshot, opening the drawer without first
  // clicking into the textarea would read selectionStart=0 and silently
  // insert the link at the top of a long article — invisible to a
  // scrolled-down author. See wiki/synthesis/2026-05-24-blog-tidy-ceo-review.md
  // E2 for the diagnosis.
  const lastCursorRef = useRef<{ start: number; end: number } | null>(null);

  // Auto-create-draft on first non-empty title keystroke. Materialises
  // a postId so the image upload + suggest-links + preview affordances
  // unlock without forcing the author to manually click Save first.
  // Debounced 300ms; cancels if the user clears the title before the
  // timer fires; silent failure (manual Save still works as fallback).
  // See wiki/synthesis/2026-05-24-blog-tidy-ceo-review.md T2.
  //
  // Keystroke window: the user may type 1-2 more characters in the
  // ~50-200ms between POST-fire and router.replace completing. Those
  // chars land in the unmounting create page's state and are not
  // round-tripped to the destination edit page. Mitigation: the
  // "Creating draft…" indicator gives a visual pause so the author
  // naturally stops typing during the transition. Worst-case loss is
  // 1-2 chars on the title field; user retypes on the edit page.
  const autoCreateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoCreatePending, setAutoCreatePending] = useState(false);
  useEffect(() => {
    if (isEdit) return; // Edit mode never auto-creates
    const trimmed = title.trim();
    // Empty title cancels any pending auto-create
    if (trimmed.length === 0) {
      if (autoCreateTimerRef.current) {
        clearTimeout(autoCreateTimerRef.current);
        autoCreateTimerRef.current = null;
      }
      return;
    }
    if (autoCreateTimerRef.current) clearTimeout(autoCreateTimerRef.current);
    autoCreateTimerRef.current = setTimeout(async () => {
      autoCreateTimerRef.current = null;
      setAutoCreatePending(true);
      try {
        const res = await fetch("/api/admin/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, status: "draft" }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          // Silent — manual Save still works. Surface the error only
          // if it persists through a manual save attempt.
          setAutoCreatePending(false);
          return;
        }
        router.replace(`/admin/blog/posts/${json.data.post.id}`);
      } catch {
        setAutoCreatePending(false);
      }
    }, 300);
    return () => {
      if (autoCreateTimerRef.current) {
        clearTimeout(autoCreateTimerRef.current);
        autoCreateTimerRef.current = null;
      }
    };
  }, [title, isEdit, router]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveStatus({ kind: "saving" });

    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const scheduledPublishAt =
      status === "scheduled" && scheduledDate && scheduledTime
        ? melbourneWallToUtcIso(`${scheduledDate}T${scheduledTime}`)
        : null;

    const body = {
      slug,
      title,
      contentMd,
      excerpt: excerpt || null,
      seoTitle: seoTitle || null,
      seoDescription: seoDescription || null,
      authorId: authorId || null,
      categoryId: categoryId || null,
      tags,
      status,
      visibility,
      needsReview,
      scheduledPublishAt,
      ogImageAlt: ogImageAlt.trim() || null,
      ...(isEdit
        ? { expectedUpdatedAt: lastKnownUpdatedAt.toISOString() }
        : {}),
    };

    try {
      const url = isEdit
        ? `/api/admin/posts/${initial!.id}`
        : "/api/admin/posts";
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

      const sideEffects: SideEffectSummary | undefined = json.data?.sideEffects;
      setSaveStatus({ kind: "saved", sideEffects });

      if (!isEdit) {
        router.push(`/admin/blog/posts/${json.data.post.id}`);
      } else {
        // Sync the optimistic-lock anchor from the server's response
        // BEFORE router.refresh(). Without this, the next save sends
        // a stale expectedUpdatedAt and 409s — the form gets stuck
        // in a "Someone else saved this post" loop even with a single
        // author. router.refresh() re-renders the server component
        // with fresh `initial`, but PostForm's useState lastKnownUpdatedAt
        // captures only on first mount and ignores `initial` updates.
        const nextUpdatedAt = json.data?.post?.updatedAt;
        if (nextUpdatedAt) {
          setLastKnownUpdatedAt(new Date(nextUpdatedAt));
        }
        router.refresh();
        setTimeout(() => setSaveStatus({ kind: "idle" }), 4000);
      }
    } catch {
      setSaveStatus({ kind: "error", message: "Network error — try again." });
    }
  }

  function triggerFilePicker() {
    if (!isEdit) {
      setImageStatus({
        kind: "error",
        message: "Save the post first, then upload an image.",
      });
      return;
    }
    fileInputRef.current?.click();
  }

  async function onImageFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so re-uploading the same file fires onChange again.
    e.target.value = "";
    if (!file || !isEdit) return;

    // Client-side gate: alt-text is mandatory before any upload (the
    // server also enforces this; this just gives a faster + clearer
    // error than waiting for the round-trip).
    const altTrimmed = ogImageAlt.trim();
    if (!altTrimmed) {
      setImageStatus({
        kind: "error",
        message: "Add alt text before uploading — required for accessibility.",
      });
      return;
    }

    // Client-side gate: 10 MB sanity ceiling. The server auto-compresses
    // anything above the 500 KB DB cap, so we only block pathological
    // inputs (decompression bombs, multi-megapixel raw exports).
    const sizeKb = Math.round(file.size / 1024);
    if (sizeKb > IMAGE_MAX_KB) {
      setImageStatus({
        kind: "error",
        message: `Image too large (${Math.round(sizeKb / 1024)} MB) — max ${Math.round(IMAGE_MAX_KB / 1024)} MB.`,
      });
      return;
    }

    setImageStatus({ kind: "working" });
    const fd = new FormData();
    fd.append("file", file);
    fd.append("alt", altTrimmed);

    try {
      const res = await fetch(`/api/admin/posts/${initial!.id}/image`, {
        method: "PUT",
        body: fd,
      });
      const json = await res.json();
      if (res.status === 429) {
        setImageStatus({
          kind: "error",
          message: "Rate limit reached — try again in an hour.",
        });
        return;
      }
      if (res.status === 503) {
        setImageStatus({
          kind: "error",
          message:
            "Image storage not configured on this server — contact ops.",
        });
        return;
      }
      if (!res.ok || !json.ok) {
        setImageStatus({
          kind: "error",
          message: json.error ?? "Upload failed.",
        });
        return;
      }
      // Sync ALL image metadata from the server's response — width,
      // height, filename, sizeKb, alt — so the preview reflects what
      // landed in the DB rather than the client's pre-upload guesses.
      setOgImagePath(json.data.ogImagePath);
      setOgImageAlt(json.data.ogImageAlt ?? altTrimmed);
      setOgImageWidth(json.data.ogImageWidth ?? null);
      setOgImageHeight(json.data.ogImageHeight ?? null);
      setOgImageFilename(json.data.ogImageFilename ?? null);
      setOgImageSizeKb(json.data.ogImageSizeKb ?? null);
      setLastKnownUpdatedAt(new Date(json.data.updatedAt));
      // Soft-warn against the POST-COMPRESSION size returned by the
      // server, not the original upload size. Only fires when the
      // compression pipeline had to dip into the resize ladder.
      const finalSizeKb = json.data.ogImageSizeKb ?? sizeKb;
      const overSoft = finalSizeKb > IMAGE_SOFT_WARN_KB;
      setImageStatus({
        kind: "ok",
        message: overSoft
          ? `Image uploaded (${finalSizeKb} KB — over the ${IMAGE_SOFT_WARN_KB} KB soft target; consider optimising the source).`
          : `Image uploaded (${finalSizeKb} KB).`,
      });
      router.refresh();
      setTimeout(() => setImageStatus({ kind: "idle" }), overSoft ? 8000 : 3000);
    } catch {
      setImageStatus({ kind: "error", message: "Network error." });
    }
  }

  async function onRemoveImage() {
    if (!isEdit) return;
    if (!confirm("Remove the featured image? It can be re-uploaded any time.")) {
      return;
    }
    setImageStatus({ kind: "working" });
    try {
      const res = await fetch(`/api/admin/posts/${initial!.id}/image`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setImageStatus({
          kind: "error",
          message: json.error ?? "Remove failed.",
        });
        return;
      }
      // Soft-delete on the server (og_image_path stays for grace
      // period). For the form UI, treat it as gone: clear the local
      // preview + metadata so the "Upload" affordance reappears.
      setOgImagePath(null);
      setOgImageWidth(null);
      setOgImageHeight(null);
      setOgImageFilename(null);
      setOgImageSizeKb(null);
      // Keep ogImageAlt in state — it's still the alt the user wants
      // if they immediately re-upload a replacement image.
      setLastKnownUpdatedAt(new Date(json.data.updatedAt));
      setImageStatus({ kind: "ok", message: "Image removed." });
      router.refresh();
      setTimeout(() => setImageStatus({ kind: "idle" }), 3000);
    } catch {
      setImageStatus({ kind: "error", message: "Network error." });
    }
  }

  async function onMarkReviewed() {
    if (!isEdit) return;
    setReviewedStatus({ kind: "working" });
    // We mark reviewed by PUT-ing the same post with needsReview=false.
    // That bumps updatedAt + writes a revision row, which is the right
    // audit signal (someone explicitly confirmed this post is OK).
    setNeedsReview(false);
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const body = {
      slug,
      title,
      contentMd,
      excerpt: excerpt || null,
      seoTitle: seoTitle || null,
      seoDescription: seoDescription || null,
      authorId: authorId || null,
      categoryId: categoryId || null,
      tags,
      status,
      visibility,
      needsReview: false,
      scheduledPublishAt:
        status === "scheduled" && scheduledDate && scheduledTime
          ? melbourneWallToUtcIso(`${scheduledDate}T${scheduledTime}`)
          : null,
      ogImageAlt: ogImageAlt.trim() || null,
      expectedUpdatedAt: lastKnownUpdatedAt.toISOString(),
    };
    try {
      const res = await fetch(`/api/admin/posts/${initial!.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setReviewedStatus({
          kind: "error",
          message: json.error ?? "Could not mark reviewed.",
        });
        // Roll back optimistic UI toggle
        setNeedsReview(true);
        return;
      }
      setReviewedStatus({ kind: "ok", message: "Marked reviewed." });
      router.refresh();
      setTimeout(() => setReviewedStatus({ kind: "idle" }), 3000);
    } catch {
      setReviewedStatus({ kind: "error", message: "Network error." });
      setNeedsReview(true);
    }
  }

  function insertLinkAtCursor(markdown: string) {
    const ta = contentRef.current;
    const isLive = ta != null && document.activeElement === ta;
    const result = computeLinkInsertion({
      contentMd,
      markdown,
      isLive,
      liveStart: isLive ? (ta!.selectionStart ?? null) : null,
      liveEnd: isLive ? (ta!.selectionEnd ?? null) : null,
      snapshot: lastCursorRef.current,
    });

    setContentMd(result.nextContent);

    // Telemetry: confirms the T1 fix is firing in production. Canary
    // monitor scrapes the JSON line. See T6 in the plan.
    if (typeof console !== "undefined") {
      console.info(
        JSON.stringify({
          event: "post.insert_link",
          postId: initial?.id ?? null,
          insertion_kind: result.kind,
          length: result.insertion.length,
        }),
      );
    }

    // Restore focus + cursor on the textarea (no-op if ref is null).
    if (ta) {
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(result.cursor, result.cursor);
        lastCursorRef.current = { start: result.cursor, end: result.cursor };
      });
    }
  }

  // Snapshot the textarea cursor whenever it might change. selectionchange
  // on document is more reliable than onSelect for keyboard navigation,
  // but onSelect+onBlur covers the common mouse/blur paths and is enough
  // for the drawer-insert use case.
  function snapshotCursor() {
    const ta = contentRef.current;
    if (!ta) return;
    lastCursorRef.current = {
      start: ta.selectionStart ?? 0,
      end: ta.selectionEnd ?? 0,
    };
  }

  const bytesUsed = new TextEncoder().encode(contentMd).length;
  const bytesOver = bytesUsed > CONTENT_MD_MAX_BYTES;

  // Schedule validation surfaces field-presence inline; the past-vs-
  // future check is enforced by the server (Zod + enforceScheduleInvariant
  // in lib/posts-admin) — calling Date.now() during render would be
  // impure and would re-compute on every render anyway. The HTML5 `min`
  // attribute on the datetime-local input nudges users toward future
  // times at pick time; the server is the source of truth.
  const scheduleMissing =
    status === "scheduled" && (scheduledDate === "" || scheduledTime === "");
  const canSubmit =
    !bytesOver && !scheduleMissing && saveStatus.kind !== "saving";

  // Computed once at mount — anchors the date input's `min` attribute
  // (today in Melbourne) so the calendar greys out past days. The
  // server-side check (Zod + enforceScheduleInvariant) is the actual
  // source of truth.
  const [todayInMelbourne] = useState(() => {
    const parts = melbourneParts(new Date());
    return `${parts.year}-${parts.month}-${parts.day}`;
  });
  // TZ label shown next to the picker (AEDT in summer, AEST in winter).
  // Recomputed on each render — cheap, ensures DST transitions don't lie.
  const tzAbbrev = melbourneTzAbbrev();

  return (
    <form onSubmit={onSave} className="space-y-8">
      {saveStatus.kind === "stale" ? (
        <div
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200"
        >
          <p className="font-semibold">Someone else saved this post.</p>
          <p className="mt-1">
            The post was modified at {saveStatus.currentUpdatedAt}. Reload
            to see their changes, or save anyway to overwrite them.
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
              onClick={() => {
                // "Save anyway to overwrite them" — adopt the server's
                // current updatedAt as our new anchor so the next save
                // passes optimistic-lock. Without this, dismissing the
                // banner leaves expectedUpdatedAt stale and the next
                // save 409s identically.
                if (saveStatus.kind === "stale") {
                  setLastKnownUpdatedAt(new Date(saveStatus.currentUpdatedAt));
                }
                setSaveStatus({ kind: "idle" });
              }}
              className="text-ink-subtle hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {/* Title + Slug */}
      <div className="grid gap-x-6 gap-y-6 md:grid-cols-2">
        <div>
          <label className={labelClass}>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`${inputClass} mt-2`}
            placeholder="Why data lineage matters"
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
            placeholder="why-data-lineage-matters"
            required
            maxLength={200}
            pattern="[a-z0-9][a-z0-9-]*[a-z0-9]?"
            title="Lower-case kebab-case (letters, digits, hyphens)"
          />
          <p className="mt-2 text-[12px] text-ink-subtle">
            Public URL: /blog/{slug || "<slug>"}
          </p>
        </div>
      </div>

      {/* Status / Visibility / Scheduled-at */}
      <div className="grid gap-x-6 gap-y-6 md:grid-cols-3">
        <div>
          <label className={labelClass}>Status</label>
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as Exclude<PostStatus, "archived">)
            }
            className={`${inputClass} mt-2`}
          >
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="published">Published</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Visibility</label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as PostVisibility)}
            className={`${inputClass} mt-2`}
          >
            <option value="listed">Listed (shows on /blog)</option>
            <option value="unlisted">Unlisted (direct URL only)</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>
            Publish at ({tzAbbrev})
          </label>
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-2">
            <DateField
              value={scheduledDate}
              onChange={setScheduledDate}
              placeholder="DD/MM/YYYY"
              disabled={status !== "scheduled"}
              min={todayInMelbourne}
            />
            <input
              type="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              onClick={openNativePicker}
              onFocus={openNativePicker}
              disabled={status !== "scheduled"}
              aria-label="Publish time (Melbourne)"
              className={`${inputClass} w-[140px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-100 [&::-webkit-calendar-picker-indicator]:invert dark:[&::-webkit-calendar-picker-indicator]:invert`}
            />
          </div>
          {status !== "scheduled" ? (
            <p className="mt-2 text-[11px] text-ink-subtle">
              Switch Status to &ldquo;Scheduled&rdquo; to enable.
            </p>
          ) : scheduleMissing ? (
            <p className="mt-2 text-[11px] text-red-500">
              Pick a date and time (Melbourne).
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-ink-subtle">
              Cron auto-publishes around{" "}
              {formatMelbourneForHumans(`${scheduledDate}T${scheduledTime}`)}{" "}
              ({tzAbbrev}). Server rejects past times at save.
            </p>
          )}
        </div>
      </div>

      {/* Category / Author */}
      <div className="grid gap-x-6 gap-y-6 md:grid-cols-2">
        <div>
          <label className={labelClass}>Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={`${inputClass} mt-2`}
          >
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Author</label>
          <select
            value={authorId}
            onChange={(e) => setAuthorId(e.target.value)}
            className={`${inputClass} mt-2`}
          >
            <option value="">— None —</option>
            {authors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tags — own row so 8 chips have full form width to wrap into */}
      <div>
        <TagsField value={tagsText} onChange={setTagsText} />
      </div>

      {/* Excerpt */}
      <div>
        <FieldHeader
          label="Excerpt"
          count={excerpt.length}
          softLimit={SEO_DESC_SOFT_LIMIT}
        />
        <textarea
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          className={`${inputClass} mt-2 min-h-[80px]`}
          placeholder="1–2 sentence summary. Shown on /blog index, og:description fallback, newsletter card."
          maxLength={500}
        />
      </div>

      {/* Content + Live preview */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
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
        <div className="grid gap-4 md:grid-cols-2">
          <textarea
            ref={contentRef}
            value={contentMd}
            onChange={(e) => setContentMd(e.target.value)}
            onSelect={snapshotCursor}
            onKeyUp={snapshotCursor}
            onMouseUp={snapshotCursor}
            onBlur={snapshotCursor}
            className={`${inputClass} min-h-[600px] font-mono text-sm`}
            placeholder="# Heading&#10;&#10;Paragraph…"
          />
          <div className="min-h-[600px] overflow-auto rounded-md border border-hairline bg-surface-1">
            <PreviewPane content={deferredContent} />
          </div>
        </div>
        <p className="mt-2 text-[12px] text-ink-subtle">
          Markdown only — GitHub-flavoured tables + footnotes supported.
          HTML tags are escaped (XSS posture).
        </p>
      </div>

      {/* SEO */}
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
            Google truncates around 60 characters; up to 80 allowed.
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
            placeholder="Optional — falls back to the excerpt above"
            maxLength={300}
          />
          <p className="mt-2 text-[11px] text-ink-subtle">
            Google truncates around 160 characters; up to 300 allowed.
          </p>
        </div>
      </div>

      {/* Featured image — upload from device, persists to R2 + post row */}
      <div className="rounded-md border border-hairline bg-surface-1 p-6">
        <p className={labelClass}>Featured image</p>
        {!isEdit ? (
          <p className="mt-3 text-[11px] text-ink-subtle">
            {autoCreatePending
              ? "Creating draft — image upload unlocks in a moment…"
              : title.trim()
                ? "Saving draft to unlock image upload…"
                : "Type a title to start the draft — image upload unlocks automatically."}
          </p>
        ) : (
          <>
            {/* Alt-text input — required before any upload, also editable
                without re-uploading (persisted via main Save changes). */}
            <div className="mt-4">
              <FieldHeader
                label="Alt text (required for accessibility)"
                count={ogImageAlt.length}
                softLimit={ALT_MAX_LEN}
              />
              <input
                type="text"
                value={ogImageAlt}
                onChange={(e) => setOgImageAlt(e.target.value)}
                className={`${inputClass} mt-2`}
                placeholder="A 1-2 sentence description of the image"
                maxLength={ALT_MAX_LEN}
                aria-required="true"
              />
              <p className="mt-1 text-[11px] text-ink-subtle">
                Screen readers announce this. Falls back to the post
                title on render when empty, but plain title is rarely
                the right alt — describe what&rsquo;s in the picture.
              </p>
            </div>

            {ogImagePath ? (
              <div className="mt-6 flex flex-wrap items-start gap-x-6 gap-y-3">
                {/* Preview matches the public-blog render exactly: 29:10
                    letterbox + object-cover. Whatever crop readers see
                    on /blog and /blog/[slug] is what shows here. If the
                    crop loses important detail, the author knows before
                    publish, not after. */}
                <div className="relative aspect-[29/10] w-80 overflow-hidden rounded-md border border-hairline bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ogImagePath}
                    alt={ogImageAlt || "Featured image preview"}
                    width={ogImageWidth ?? undefined}
                    height={ogImageHeight ?? undefined}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
                <div className="flex flex-col gap-y-2">
                  <button
                    type="button"
                    onClick={triggerFilePicker}
                    disabled={
                      imageStatus.kind === "working" || !ogImageAlt.trim()
                    }
                    title={
                      !ogImageAlt.trim()
                        ? "Add alt text above before uploading."
                        : undefined
                    }
                    className="rounded-md border border-hairline px-3 py-1.5 text-xs text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {imageStatus.kind === "working"
                      ? "Uploading…"
                      : "Replace image"}
                  </button>
                  <button
                    type="button"
                    onClick={onRemoveImage}
                    disabled={imageStatus.kind === "working"}
                    className="rounded-md border border-hairline px-3 py-1.5 text-xs text-ink-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove image
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={triggerFilePicker}
                  disabled={
                    imageStatus.kind === "working" || !ogImageAlt.trim()
                  }
                  title={
                    !ogImageAlt.trim()
                      ? "Add alt text above before uploading."
                      : undefined
                  }
                  className="rounded-md border border-hairline px-3 py-1.5 text-xs text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {imageStatus.kind === "working"
                    ? "Uploading…"
                    : "Upload image from device"}
                </button>
              </div>
            )}

            {/* Image metadata strip — only when we have file info */}
            {ogImagePath && ogImageFilename ? (
              <p className="mt-3 font-mono text-[11px] text-ink-subtle">
                {ogImageFilename}
                {ogImageWidth && ogImageHeight
                  ? ` · ${ogImageWidth}×${ogImageHeight}`
                  : ""}
                {ogImageSizeKb != null ? ` · ${ogImageSizeKb} KB` : ""}
                {ogImageSizeKb != null && ogImageSizeKb > IMAGE_SOFT_WARN_KB ? (
                  <span className="ml-2 text-amber-600 dark:text-amber-400">
                    (over {IMAGE_SOFT_WARN_KB} KB target — consider optimising)
                  </span>
                ) : null}
              </p>
            ) : null}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onImageFileChosen}
              className="hidden"
            />
            <p className="mt-3 text-[11px] text-ink-subtle">
              PNG / JPEG / WebP · up to {Math.round(IMAGE_MAX_KB / 1024)}
              &nbsp;MB · auto-compressed to fit ·{" "}
              {IMAGE_SOFT_WARN_KB}&nbsp;KB soft target · uploaded to R2.
              Replacing creates a new timestamped key — the old file stays
              in R2 in case external caches still reference it.
            </p>
            {imageStatus.kind === "ok" ? (
              <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                {imageStatus.message}
              </p>
            ) : imageStatus.kind === "error" ? (
              <p className="mt-2 text-xs text-red-500" role="alert">
                {imageStatus.message}
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Curation tools — suggest links + mark reviewed */}
      <div className="rounded-md border border-hairline bg-surface-1 p-6">
        <p className={labelClass}>Curation tools</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            disabled={!isEdit}
            className="rounded-md border border-hairline px-3 py-1.5 text-xs text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              !isEdit
                ? "Save the post first, then suggestions can run."
                : undefined
            }
          >
            Suggest internal links
          </button>
          {isEdit && initial?.needsReview ? (
            <button
              type="button"
              onClick={onMarkReviewed}
              disabled={reviewedStatus.kind === "working"}
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300"
            >
              {reviewedStatus.kind === "working"
                ? "Marking…"
                : "Mark reviewed"}
            </button>
          ) : null}
          {reviewedStatus.kind === "ok" ? (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              {reviewedStatus.message}
            </span>
          ) : reviewedStatus.kind === "error" ? (
            <span className="text-xs text-red-500" role="alert">
              {reviewedStatus.message}
            </span>
          ) : null}
        </div>
        {isEdit ? (
          <p className="mt-3 text-[11px] text-ink-subtle">
            Link suggestions rate-limited at 60/hr. Embedding refresh
            runs automatically on save when content shifts &gt;5%.
          </p>
        ) : (
          <p className="mt-3 text-[11px] text-ink-subtle">
            {autoCreatePending
              ? "Creating draft — curation tools unlock in a moment…"
              : "Curation tools unlock once the draft is created (auto-saves on first title keystroke)."}
          </p>
        )}
      </div>

      {/* Save row */}
      <div className="flex items-center justify-between border-t border-hairline pt-6">
        <SaveStatusLabel status={saveStatus} />
        <div className="flex items-center gap-x-3">
          <button
            type="button"
            onClick={() => router.push("/admin/blog/posts")}
            className="text-sm text-ink-subtle hover:text-ink"
          >
            Cancel
          </button>
          {/* Preview button — opens the full-chrome preview route in a
              new tab so the author can validate hero image, TOC, byline,
              read-next, etc. without losing their editor state. Only
              meaningful once a postId exists; on create mode the auto-
              create-draft pattern (T2) materialises one on first
              keystroke, but until then there's nothing to preview. */}
          <a
            href={isEdit ? `/admin/blog/posts/${initial!.id}/preview` : "#"}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!isEdit}
            onClick={(e) => {
              if (!isEdit) e.preventDefault();
            }}
            className={`rounded-md border border-hairline px-4 py-2 text-sm text-ink hover:bg-surface-2 ${
              !isEdit ? "cursor-not-allowed opacity-50" : ""
            }`}
            title={
              !isEdit
                ? "Preview unlocks once the draft is created (auto-saves on first title keystroke)."
                : "Open the full reader view in a new tab"
            }
          >
            Preview
          </a>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-canvas hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saveStatus.kind === "saving"
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : "Create post"}
          </button>
        </div>
      </div>

      {/* Link suggestions drawer (overlay) */}
      {isEdit ? (
        <LinkSuggestionsDrawer
          open={drawerOpen}
          postId={initial!.id}
          draft={{ title, excerpt, contentMd }}
          onClose={() => setDrawerOpen(false)}
          onInsertLink={insertLinkAtCursor}
        />
      ) : null}
    </form>
  );
}

function SaveStatusLabel({ status }: { status: SaveStatus }) {
  switch (status.kind) {
    case "idle":
      return null;
    case "saving":
      return <span className="text-sm text-ink-subtle">Saving…</span>;
    case "saved": {
      const messages: string[] = ["✓ Saved · new revision created"];
      if (status.sideEffects?.ogRegenerated === "failed") {
        messages.push(
          `OG regen failed (${status.sideEffects.ogError ?? "see logs"})`,
        );
      }
      if (status.sideEffects?.embeddingRegenerated === "failed") {
        messages.push(
          `Embedding refresh failed (${status.sideEffects.embeddingError ?? "see logs"})`,
        );
      }
      const hasWarnings = messages.length > 1;
      return (
        <span
          className={`text-sm ${
            hasWarnings
              ? "text-amber-600 dark:text-amber-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {messages.join(" · ")}
        </span>
      );
    }
    case "error":
      return (
        <span className="text-sm text-red-500" role="alert">
          {status.message}
        </span>
      );
    case "stale":
      return null;
  }
}

const TAG_MAX = 8;
const TAG_MAX_LEN = 64;

/**
 * Tags input. Single text field for comma-separated entry + a live chip
 * preview below so 8 tags don't have to visually fit in a single-line
 * input. Empty / whitespace-only segments are dropped from the preview;
 * the underlying string state is what the form submits (parsed into
 * trimmed-non-empty strings at save).
 *
 * The cap is also enforced by the Zod schema (lib/posts-admin/schema.ts
 * → TagsSchema) — if a migrated post arrived with >8 tags, the count
 * goes red and save is blocked until the author trims.
 */
function TagsField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const tags = value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const overCount = tags.length > TAG_MAX;
  const overLength = tags.some((t) => t.length > TAG_MAX_LEN);

  function removeAt(idx: number) {
    const next = tags.filter((_, i) => i !== idx).join(", ");
    onChange(next);
  }

  return (
    <>
      <FieldHeader
        label="Tags (comma-separated)"
        count={tags.length}
        softLimit={TAG_MAX}
        unit="tags"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} mt-2`}
        placeholder="ai, data-architecture, governance"
      />
      {tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t, idx) => {
            const tooLong = t.length > TAG_MAX_LEN;
            return (
              <span
                key={`${t}-${idx}`}
                className={`group inline-flex items-center gap-x-1 rounded-full border px-2 py-0.5 text-[11px] ${
                  tooLong
                    ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                    : "border-hairline bg-surface-2 text-ink-subtle"
                }`}
                title={tooLong ? `Tag exceeds ${TAG_MAX_LEN} chars` : undefined}
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeAt(idx)}
                  aria-label={`Remove tag ${t}`}
                  className="text-ink-subtle/60 hover:text-ink"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      <p
        className={`mt-2 text-[11px] ${
          overCount || overLength ? "text-red-500" : "text-ink-subtle"
        }`}
      >
        {overCount
          ? `Too many tags (max ${TAG_MAX}). Remove ${tags.length - TAG_MAX}.`
          : overLength
            ? `One or more tags exceed ${TAG_MAX_LEN} chars — shorten before saving.`
            : `Up to ${TAG_MAX} tags. Each up to ${TAG_MAX_LEN} chars.`}
      </p>
    </>
  );
}

function FieldHeader({
  label,
  count,
  softLimit,
  unit = "chars",
}: {
  label: string;
  count: number;
  softLimit: number;
  /** Singular label shown after the count. "chars" by default;
   *  override for non-char counters (e.g. tags). */
  unit?: string;
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
        {count} / {softLimit} {unit}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local picker UI helper. Melbourne timezone helpers live in
// lib/format-melbourne.ts (shared with the admin posts list so the picker
// and the list never drift on wall-time rendering).
// ---------------------------------------------------------------------------

/**
 * Open the browser's native picker on focus/click. Without this, the
 * picker only opens when you click the tiny calendar/clock icon on the
 * right edge of the input — which is invisible on dark themes. Uses
 * showPicker() (Chrome 99+, Edge 99+, Firefox 101+, Safari 16+); silently
 * no-ops on older browsers, which fall back to icon-click anyway.
 *
 * Wrapped in try/catch because showPicker() throws if the call isn't
 * a "user gesture" — we accept the throw and let the user click the
 * icon as fallback.
 */
function openNativePicker(e: React.SyntheticEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  if (el.disabled) return;
  if (typeof el.showPicker !== "function") return;
  try {
    el.showPicker();
  } catch {
    /* ignore — user can still click the indicator icon */
  }
}

