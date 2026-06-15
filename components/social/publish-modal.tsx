"use client";

import { useState, useCallback } from "react";
import { XIcon, LinkedinIcon, BlueskyIcon } from "@/components/icons/social";
import { DateField } from "@/components/ui/date-field";
import type { SocialPlatform } from "@/lib/social/types";
import {
  PLATFORM_CHAR_LIMITS,
  PLATFORM_DISPLAY_NAMES,
  SOCIAL_PLATFORMS,
} from "@/lib/social/types";

interface PublishModalProps {
  defaultContent: string;
  connectedPlatforms: SocialPlatform[];
  onClose: () => void;
  onPublished?: () => void;
  onScheduled?: () => void;
}

const PLATFORM_ICONS: Record<
  SocialPlatform,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
> = {
  twitter: XIcon,
  linkedin: LinkedinIcon,
  bluesky: BlueskyIcon,
};

const TIME_SUGGESTIONS: Record<
  SocialPlatform,
  { label: string; day: string; time: string }[]
> = {
  twitter: [
    { label: "Mon 12pm", day: "Mon", time: "12:00" },
    { label: "Tue 9am", day: "Tue", time: "09:00" },
    { label: "Thu 10am", day: "Thu", time: "10:00" },
  ],
  linkedin: [
    { label: "Tue 8am", day: "Tue", time: "08:00" },
    { label: "Wed 10am", day: "Wed", time: "10:00" },
    { label: "Thu 2pm", day: "Thu", time: "14:00" },
  ],
  bluesky: [
    { label: "Mon 6pm", day: "Mon", time: "18:00" },
    { label: "Wed 7pm", day: "Wed", time: "19:00" },
    { label: "Fri 5pm", day: "Fri", time: "17:00" },
  ],
};

function getNextDayTime(
  dayName: string,
  time: string,
): { date: string; time: string } {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const targetDay = days.indexOf(dayName);
  const now = new Date();
  const currentDay = now.getDay();
  let daysAhead = targetDay - currentDay;
  if (daysAhead <= 0) daysAhead += 7;
  const target = new Date(now);
  target.setDate(now.getDate() + daysAhead);
  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, time };
}

interface PlatformResult {
  platform: SocialPlatform;
  status: "success" | "error" | "reconnect_required";
  publishedUrl?: string;
  error?: string;
}

const X_PREMIUM_LIMIT = 25_000;
const X_PREMIUM_KEY = "archos_x_premium";

function getEffectiveLimit(platform: SocialPlatform, xPremium: boolean): number {
  if (platform === "twitter" && xPremium) return X_PREMIUM_LIMIT;
  return PLATFORM_CHAR_LIMITS[platform];
}

function truncateForPlatform(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + "...";
}

export function PublishModal({
  defaultContent,
  connectedPlatforms,
  onClose,
  onPublished,
  onScheduled,
}: PublishModalProps) {
  const [xPremium, setXPremium] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(X_PREMIUM_KEY) === "true";
  });
  const [selectedPlatforms, setSelectedPlatforms] = useState<
    Set<SocialPlatform>
  >(new Set(connectedPlatforms));
  const [perPlatformContent, setPerPlatformContent] = useState<
    Record<SocialPlatform, string>
  >(() => {
    const initial: Record<string, string> = {};
    const savedPremium =
      typeof window !== "undefined" &&
      localStorage.getItem(X_PREMIUM_KEY) === "true";
    for (const p of SOCIAL_PLATFORMS) {
      const limit = getEffectiveLimit(p, savedPremium);
      initial[p] = truncateForPlatform(defaultContent, limit);
    }
    return initial as Record<SocialPlatform, string>;
  });
  const [activeTab, setActiveTab] = useState<SocialPlatform>(
    connectedPlatforms[0] ?? "twitter",
  );
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<PlatformResult[] | null>(null);

  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);

  const togglePlatform = useCallback((platform: SocialPlatform) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }, []);

  const handlePublish = useCallback(async () => {
    if (publishing || selectedPlatforms.size === 0) return;

    // Every selected platform needs content. The server rejects an empty one
    // with a generic message, so catch it here, name the platform, and switch
    // to its tab — otherwise an untouched (auto-selected) platform fails
    // silently while a full tab is on screen.
    const emptyPublish = [...selectedPlatforms].filter(
      (p) => !(perPlatformContent[p] ?? "").trim(),
    );
    if (emptyPublish.length > 0) {
      setActiveTab(emptyPublish[0]);
      setResults(
        emptyPublish.map((p) => ({
          platform: p,
          status: "error" as const,
          error: "Add content for this platform, or unselect it above.",
        })),
      );
      return;
    }

    setPublishing(true);
    setResults(null);

    const platforms: Record<string, { content: string }> = {};
    for (const p of selectedPlatforms) {
      platforms[p] = { content: perPlatformContent[p] };
    }

    try {
      const res = await fetch("/api/social/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms }),
      });
      const data = await res.json();
      if (data.results) {
        setResults(data.results);
        const allSuccess = data.results.every(
          (r: PlatformResult) => r.status === "success",
        );
        if (allSuccess) onPublished?.();
      } else {
        setResults([
          {
            platform: "twitter",
            status: "error",
            error: data.error ?? "Publish failed.",
          },
        ]);
      }
    } catch {
      setResults([
        {
          platform: "twitter",
          status: "error",
          error: "Network error. Try again.",
        },
      ]);
    } finally {
      setPublishing(false);
    }
  }, [publishing, selectedPlatforms, perPlatformContent, onPublished]);

  const handleSchedule = useCallback(async () => {
    if (
      scheduleSubmitting ||
      selectedPlatforms.size === 0 ||
      !scheduledDate ||
      !scheduledTime
    )
      return;

    // Same guard as publish: a selected-but-empty platform would fail on the
    // server with a generic "Content is required". Catch it, name it, jump to it.
    const emptySchedule = [...selectedPlatforms].filter(
      (p) => !(perPlatformContent[p] ?? "").trim(),
    );
    if (emptySchedule.length > 0) {
      setActiveTab(emptySchedule[0]);
      setScheduleResult({
        ok: false,
        error: `Add content for ${emptySchedule
          .map((p) => PLATFORM_DISPLAY_NAMES[p])
          .join(", ")}, or unselect ${
          emptySchedule.length > 1 ? "them" : "it"
        } above.`,
      });
      return;
    }

    setScheduleSubmitting(true);
    setScheduleResult(null);

    const scheduledFor = new Date(
      `${scheduledDate}T${scheduledTime}`,
    ).toISOString();
    const displayTimezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone;

    try {
      const promises = [...selectedPlatforms].map(async (platform) => {
        const res = await fetch("/api/social/scheduled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform,
            content: perPlatformContent[platform],
            scheduledFor,
            displayTimezone,
          }),
        });
        return res.json();
      });
      const results = await Promise.all(promises);
      const anyFailed = results.some((r) => !r.ok);
      if (anyFailed) {
        const firstError = results.find((r) => !r.ok);
        setScheduleResult({
          ok: false,
          error: firstError?.error ?? "Schedule failed.",
        });
      } else {
        setScheduleResult({ ok: true });
        onScheduled?.();
      }
    } catch {
      setScheduleResult({ ok: false, error: "Network error. Try again." });
    } finally {
      setScheduleSubmitting(false);
    }
  }, [
    scheduleSubmitting,
    selectedPlatforms,
    scheduledDate,
    scheduledTime,
    perPlatformContent,
    onScheduled,
  ]);

  const currentContent = perPlatformContent[activeTab] ?? "";
  const charLimit = getEffectiveLimit(activeTab, xPremium);
  const charCount = currentContent.length;
  const charWarning = charCount > charLimit * 0.9;
  const charOver = charCount > charLimit;

  const handleXPremiumToggle = () => {
    const next = !xPremium;
    setXPremium(next);
    localStorage.setItem(X_PREMIUM_KEY, String(next));
    const newLimit = next ? X_PREMIUM_LIMIT : PLATFORM_CHAR_LIMITS.twitter;
    setPerPlatformContent((prev) => ({
      ...prev,
      twitter: truncateForPlatform(
        prev.twitter.length < newLimit ? defaultContent : prev.twitter,
        newLimit,
      ),
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-lg border border-hairline bg-surface-2 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <h3 className="text-base font-semibold text-ink">
            Publish to Social
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-subtle hover:text-ink"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {connectedPlatforms.map((platform) => {
              const Icon = PLATFORM_ICONS[platform];
              const selected = selectedPlatforms.has(platform);
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() => {
                    togglePlatform(platform);
                    if (!selected) setActiveTab(platform);
                  }}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-hairline text-ink-subtle hover:border-primary/50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {PLATFORM_DISPLAY_NAMES[platform]}
                </button>
              );
            })}
          </div>

          {selectedPlatforms.has("twitter") && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleXPremiumToggle}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                  xPremium ? "bg-primary" : "bg-surface-1 border border-hairline"
                }`}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform ${
                    xPremium ? "translate-x-3.5" : "translate-x-0.5"
                  }`}
                />
              </button>
              <span className="text-[11px] text-ink-subtle">
                X Premium <span className="text-ink-subtle/60">(25,000 chars)</span>
              </span>
            </div>
          )}

          {selectedPlatforms.size > 0 && (
            <>
              <div className="flex gap-1 border-b border-hairline">
                {[...selectedPlatforms].map((platform) => (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => setActiveTab(platform)}
                    className={`relative px-3 py-2 text-xs font-medium transition-colors ${
                      activeTab === platform
                        ? "text-ink"
                        : "text-ink-subtle hover:text-ink"
                    }`}
                  >
                    {PLATFORM_DISPLAY_NAMES[platform]}
                    {activeTab === platform && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                    )}
                  </button>
                ))}
              </div>

              <div>
                <textarea
                  value={currentContent}
                  onChange={(e) =>
                    setPerPlatformContent((prev) => ({
                      ...prev,
                      [activeTab]: e.target.value,
                    }))
                  }
                  rows={6}
                  className="w-full resize-none rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-subtle/50 focus:border-primary focus:outline-none"
                  placeholder={`Content for ${PLATFORM_DISPLAY_NAMES[activeTab]}...`}
                />
                <div className="mt-1 flex justify-end">
                  <span
                    className={`text-xs ${
                      charOver
                        ? "text-red-400"
                        : charWarning
                          ? "text-yellow-400"
                          : "text-ink-subtle"
                    }`}
                  >
                    {charCount}/{charLimit}
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Schedule toggle */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => setScheduleMode(!scheduleMode)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                scheduleMode
                  ? "bg-primary"
                  : "bg-surface-1 border border-hairline"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                  scheduleMode ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
            <span className="text-xs text-ink-subtle">
              Schedule for later
            </span>
          </div>

          {scheduleMode && (
            <div className="space-y-3 rounded-md border border-hairline bg-surface-1 p-3">
              <div className="flex gap-2">
                <DateField
                  value={scheduledDate}
                  onChange={(v) => {
                    setScheduledDate(v);
                    setScheduleResult(null);
                  }}
                  placeholder="DD/MM/YYYY"
                  className="flex-1"
                />
                <input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => {
                    setScheduledTime(e.target.value);
                    setScheduleResult(null);
                  }}
                  className="w-28 rounded-md border border-hairline bg-surface-2 px-2.5 py-1.5 text-xs text-ink focus:border-primary focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(TIME_SUGGESTIONS[activeTab] ?? []).map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => {
                      const next = getNextDayTime(s.day, s.time);
                      setScheduledDate(next.date);
                      setScheduledTime(next.time);
                      setScheduleResult(null);
                    }}
                    className="rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[10px] text-ink-subtle hover:border-primary/50 hover:text-ink transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {scheduledDate && scheduledTime && (
                <p className="text-[10px] text-ink-subtle">
                  Scheduled for{" "}
                  {new Date(`${scheduledDate}T${scheduledTime}`).toLocaleString(
                    "en-AU",
                    {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    },
                  )}{" "}
                  ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                </p>
              )}
            </div>
          )}

          {/* Schedule result feedback */}
          {scheduleResult && (
            <div
              className={`rounded-md border px-3 py-2 text-xs ${
                scheduleResult.ok
                  ? "border-green-700/40 bg-green-950/20 text-green-400"
                  : "border-red-700/40 bg-red-950/20 text-red-400"
              }`}
            >
              {scheduleResult.ok
                ? "Posts scheduled successfully!"
                : scheduleResult.error}
            </div>
          )}

          {results && (
            <div className="space-y-2">
              {results.map((r) => (
                <div
                  key={r.platform}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${
                    r.status === "success"
                      ? "border-green-700/40 bg-green-950/20 text-green-400"
                      : "border-red-700/40 bg-red-950/20 text-red-400"
                  }`}
                >
                  <span>
                    {PLATFORM_DISPLAY_NAMES[r.platform]}:{" "}
                    {r.status === "success" ? "Published" : r.error}
                  </span>
                  {r.publishedUrl && (
                    <a
                      href={r.publishedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:no-underline"
                    >
                      View
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-hairline px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-subtle transition-colors hover:bg-surface-1"
          >
            {results || scheduleResult ? "Close" : "Cancel"}
          </button>
          {!results &&
            !scheduleResult &&
            (scheduleMode ? (
              <button
                type="button"
                onClick={handleSchedule}
                disabled={
                  scheduleSubmitting ||
                  selectedPlatforms.size === 0 ||
                  !scheduledDate ||
                  !scheduledTime
                }
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {scheduleSubmitting ? "Scheduling..." : "Schedule"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing || selectedPlatforms.size === 0}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishing ? "Publishing..." : "Publish"}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
