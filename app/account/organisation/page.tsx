import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { OrgManagement } from "@/components/org/org-management";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Organisation",
    description: "Manage your organisation, members, and invite key.",
    path: "/account/organisation",
  });
}

export default async function OrganisationPage() {
  const auth = await getCurrentUser();
  if (!auth) {
    redirect("/login?redirect=/account/organisation");
  }

  return <OrgManagement />;
}
