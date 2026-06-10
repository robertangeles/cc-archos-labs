import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { BrainPageClient } from "./brain-page-client";

export const runtime = "nodejs";

export default async function BrainPage() {
  const auth = await getCurrentUser();
  if (!auth) {
    redirect("/login?redirect=/account/brain");
  }

  return <BrainPageClient />;
}
