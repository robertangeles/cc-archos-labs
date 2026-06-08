import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { RulesList } from "@/components/rules/rules-list";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Personalisation",
    description: "Manage your AI personalisation rules.",
    path: "/account/personalisation",
  });
}

export default function PersonalisationPage() {
  return <RulesList />;
}
