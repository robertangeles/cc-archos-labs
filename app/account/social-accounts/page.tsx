import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { SocialAccountsPage } from "@/components/social/social-accounts-page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Social Accounts",
    description:
      "Connect your social media accounts to enable content publishing.",
    path: "/account/social-accounts",
  });
}

export default function SocialAccountsRoute() {
  return <SocialAccountsPage />;
}
