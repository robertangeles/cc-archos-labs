import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ChatWorkspace } from "./chat-workspace";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "My Workspace",
    description: "Your AI workspace — chat, skills, workflows.",
    path: "/account/workspace",
  });
}

export default async function WorkspacePage() {
  const auth = await getCurrentUser();
  if (!auth) {
    redirect("/login?redirect=/account/workspace");
  }

  return (
    <ChatWorkspace
      displayName={auth.user.displayName}
      userId={auth.user.id}
    />
  );
}
