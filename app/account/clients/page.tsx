import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { ClientsView } from "@/components/clients/clients-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Clients",
    description: "Manage your consulting clients, contacts, and contracts.",
    path: "/account/clients",
  });
}

export default function ClientsPage() {
  return <ClientsView />;
}
