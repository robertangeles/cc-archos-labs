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

export type SocialLink = {
  platform: SocialPlatform;
  url: string;
};

export const SOCIAL_LINKS: SocialLink[] = [
  { platform: "linkedin", url: "https://www.linkedin.com/in/robangeles22/" },
  { platform: "x", url: "https://x.com/archoslabsxyz" },
  { platform: "github", url: "https://github.com/robertangeles/" },
  { platform: "huggingface", url: "https://huggingface.co/robangeles" },
];

export const PLATFORM_META: Record<
  SocialPlatform,
  { label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  linkedin: { label: "LinkedIn", Icon: LinkedinIcon },
  x: { label: "X", Icon: XIcon },
  github: { label: "GitHub", Icon: GithubIcon },
  huggingface: { label: "Hugging Face", Icon: HuggingFaceIcon },
};
