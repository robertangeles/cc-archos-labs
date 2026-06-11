"use client";

import { useState, useCallback, useMemo } from "react";
import { XIcon, LinkedinIcon, BlueskyIcon } from "@/components/icons/social";
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
}

const PLATFORM_ICONS: Record<
  SocialPlatform,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
> = {
  twitter: XIcon,
  linkedin: LinkedinIcon,
  bluesky: BlueskyIcon,
};

interface PlatformResult {
  platform: SocialPlatform;
  status: "success" | "error" | "reconnect_required";
  publishedUrl?: string;
  error?: string;
}

export function PublishModal({
  defaultContent,
  connectedPlatforms,
  onClose,
  onPublished,
}: PublishModalProps) {
  const [selectedPlatforms, setSelectedPlatforms] = useState<
    Set<SocialPlatform>
  >(new Set(connectedPlatforms));
  const [perPlatformContent, setPerPlatformContent] = useState<
    Record<SocialPlatform, string>
  >(() => {
    const initial: Record<string, string> = {};
    for (const p of SOCIAL_PLATFORMS) {
      initial[p] = defaultContent;
    }
    return initial as Record<SocialPlatform, string>;
  });
  const [activeTab, setActiveTab] = useState<SocialPlatform>(
    connectedPlatforms[0] ?? "twitter",
  );
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<PlatformResult[] | null>(null);

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

  const currentContent = perPlatformContent[activeTab] ?? "";
  const charLimit = PLATFORM_CHAR_LIMITS[activeTab];
  const charCount = currentContent.length;
  const charWarning = charCount > charLimit * 0.9;
  const charOver = charCount > charLimit;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-lg border border-hairline bg-surface-2 shadow-2xl">
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
            {results ? "Close" : "Cancel"}
          </button>
          {!results && (
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing || selectedPlatforms.size === 0}
              className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {publishing ? "Publishing..." : "Publish"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
