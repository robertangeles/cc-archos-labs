import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { ScheduledPostsList } from "@/components/social/scheduled-posts-list";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Social Media Posts",
    description: "View and manage your social media posts.",
    path: "/account/scheduled-posts",
  });
}

export default function ScheduledPostsPage() {
  return <ScheduledPostsList />;
}
