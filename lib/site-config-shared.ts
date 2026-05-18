import { z } from "zod";

// Client-safe site config primitives. Imported from both server code
// (lib/site-config.ts) and client components (app/admin/site/page.tsx).
// MUST NOT import from lib/db, postgres, drizzle, or any server-only
// module — doing so pulls those into the client bundle.

export const SiteSettingsSchema = z.object({
  // Brand
  siteName: z.string().min(1).max(120),
  tagline: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  // Founder / Person schema
  founderName: z.string().min(1).max(120),
  founderLinkedinUrl: z.string().max(500),
  // Newsletter / publication. Surfaced as an outbound trust link on /about
  // and as a `sameAs` entry in the Person JSON-LD when set. Empty string
  // means "not yet configured" — the link is omitted gracefully.
  modellingRoomUrl: z.string().max(500),
  // Social / OG
  ogImageUrl: z.string().max(500),
  twitterHandle: z.string().max(50),
  linkedinUrl: z.string().max(500),
});

export type SiteSettings = z.infer<typeof SiteSettingsSchema>;

export const SITE_DEFAULTS: SiteSettings = {
  siteName: "Archos Labs",
  tagline: "Built by practitioners.",
  description:
    "AI transformation practice and product studio. Senior data architecture and AI integration consulting for programs that can't afford to get it wrong.",
  founderName: "Rob Angeles",
  founderLinkedinUrl: "",
  modellingRoomUrl: "",
  ogImageUrl: "/opengraph-image",
  twitterHandle: "",
  linkedinUrl: "",
};
