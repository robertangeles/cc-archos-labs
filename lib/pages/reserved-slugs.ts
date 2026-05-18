// Pure reserved-slug membership check. Safe to import from client code
// (no `node:fs`, no server-only imports). The filesystem-touching boot
// assertion lives in lib/pages/reserved-slugs-fs.ts — server-only.
//
// Three enforcement layers in total:
//   1. Zod refinement at admin save (lib/pages/schema.ts, uses isReservedSlug)
//   2. lib/pages/resolver.ts short-circuit (server-only)
//   3. Boot-time assertion (lib/pages/reserved-slugs-fs.ts → boot-check.ts)
//
// Layer 1 must stay client-bundleable because the admin form imports
// CONTENT_MD_MAX_BYTES from lib/pages/schema.ts.

// Curated list of slugs that MUST exist in app/ as a non-CMS route.
// Add to this when adding a new top-level static route. The boot-time
// assertion (assertReservedSlugsMatchFilesystem, defined in the
// `-fs.ts` companion) will fail the deploy if these go out of sync.
//
// Internal-only directories (start with `_`) and route groups (parens)
// are excluded by `listAppTopLevelRoutes` — only public-facing
// top-level slugs belong here.
export const RESERVED_SLUGS = new Set<string>([
  "about",
  "admin",
  "ai-readiness-assessment",
  "api",
  "book",
  "contact",
  "sign-in",
  "tools",
]);

/**
 * Is this slug forbidden as a CMS page slug?
 *
 * - Case-insensitive: the catch-all may receive any casing; admin save
 *   normalises to lower-case but defence in depth is cheap.
 * - Empty string and whitespace-only treated as reserved (a "page" with
 *   no slug would shadow `/`).
 */
export function isReservedSlug(slug: string): boolean {
  const normalised = slug.trim().toLowerCase();
  if (normalised.length === 0) return true;
  return RESERVED_SLUGS.has(normalised);
}
