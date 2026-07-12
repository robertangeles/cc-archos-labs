import type { Metadata } from "next";
import { buildPageMetadata } from "../../lib/site-config";

// Search results are noindex (thin, query-generated) and carry a
// self-referential canonical. The prior `metadata = { title: "Search" }`
// set no path, so /search inherited the root layout's homepage canonical —
// making it a canonical-duplicate of "/" in Google's eyes.
export async function generateMetadata(): Promise<Metadata> {
  const meta = await buildPageMetadata({ title: "Search", path: "/search" });
  return { ...meta, robots: { index: false, follow: false } };
}

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
