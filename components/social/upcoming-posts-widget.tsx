"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { XIcon, LinkedinIcon, BlueskyIcon } from "@/components/icons/social";
import type { SocialPlatform } from "@/lib/social/types";
import { PLATFORM_DISPLAY_NAMES } from "@/lib/social/types";

const PLATFORM_ICONS: Record<
  SocialPlatform,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
> = {
  twitter: XIcon,
  linkedin: LinkedinIcon,
  bluesky: BlueskyIcon,
};

interface UpcomingPost {
  id: string;
  platform: SocialPlatform;
  contentPreview: string;
  scheduledFor: string;
  displayTimezone: string;
}

export function UpcomingPostsWidget() {
  const [posts, setPosts] = useState<UpcomingPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/social/scheduled")
      .then((r) => (r.ok ? r.json() : { posts: [] }))
      .then((data) => {
        const pending = (data.posts ?? [])
          .filter((p: UpcomingPost & { status: string }) => p.status === "pending")
          .slice(0, 5);
        setPosts(pending);
      })
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-hairline bg-surface-2 p-4">
        <div className="flex items-center gap-2 text-xs text-ink-subtle">
          <CalendarClock className="h-3.5 w-3.5" />
          <span>Loading scheduled posts...</span>
        </div>
      </div>
    );
  }

  if (posts.length === 0) return null;

  return (
    <div className="rounded-lg border border-hairline bg-surface-2 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-ink">
          <CalendarClock className="h-3.5 w-3.5" />
          Upcoming Posts
        </div>
        <Link
          href="/account/scheduled-posts"
          className="text-[10px] text-primary hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="space-y-2">
        {posts.map((post) => {
          const Icon = PLATFORM_ICONS[post.platform];
          const scheduled = new Date(post.scheduledFor);
          return (
            <div
              key={post.id}
              className="flex items-start gap-2.5 rounded-md border border-hairline bg-surface-1 px-3 py-2"
            >
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-ink">
                  {post.contentPreview}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-subtle">
                  {PLATFORM_DISPLAY_NAMES[post.platform]} &middot;{" "}
                  {scheduled.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}{" "}
                  {scheduled.toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
