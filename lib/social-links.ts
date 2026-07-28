import type { ComponentType, SVGProps } from "react";
import {
  GithubIcon,
  HuggingFaceIcon,
  LinkedinIcon,
  XIcon,
} from "../components/icons/social";

// Founder identity links — single source of truth used by:
//   - /about hero (PersonCard) — large icon row
//   - /blog/[slug] end-of-post AuthorBio — same icon row, blog scale
//
// Page-level constants on purpose: the rotation cadence is "rarely"
// and the operational cost of an admin UI for 4 URLs is higher than
// the value. If/when these need to change without dev help, lift into
// `site_setting` and read via getSiteSettings() — the shape here
// already matches what JSON-LD Person `sameAs` consumes.

export type SocialPlatform = "linkedin" | "x" | "github" | "huggingface";

/**
 * Which schema.org entity a link identifies.
 *
 * This distinction is load-bearing, not decoration. `sameAs` is how Google
 * resolves "these URLs are the same entity as this node" — so putting the
 * ORGANISATION's X account in the FOUNDER's sameAs asserts that Rob Angeles and
 * Archos Labs are one entity. That is precisely the entity-fragmentation this
 * file's consumers exist to fix, so the list has to know the difference.
 */
export type SocialEntity = "person" | "org";

export type SocialLink = {
  platform: SocialPlatform;
  url: string;
  entity: SocialEntity;
};

export const SOCIAL_LINKS: SocialLink[] = [
  {
    platform: "linkedin",
    url: "https://www.linkedin.com/in/robangeles22/",
    entity: "person",
  },
  // The brand handle, not a personal account — it is also the site's
  // twitter:site. Belongs to the Organization node.
  { platform: "x", url: "https://x.com/archoslabsxyz", entity: "org" },
  {
    platform: "github",
    url: "https://github.com/robertangeles/",
    entity: "person",
  },
  {
    platform: "huggingface",
    url: "https://huggingface.co/robangeles",
    entity: "person",
  },
];

/** URLs identifying one entity, for a schema.org `sameAs` array. */
export function sameAsFor(entity: SocialEntity): string[] {
  return SOCIAL_LINKS.filter((l) => l.entity === entity).map((l) => l.url);
}

export const PLATFORM_META: Record<
  SocialPlatform,
  { label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  linkedin: { label: "LinkedIn", Icon: LinkedinIcon },
  x: { label: "X", Icon: XIcon },
  github: { label: "GitHub", Icon: GithubIcon },
  huggingface: { label: "Hugging Face", Icon: HuggingFaceIcon },
};
