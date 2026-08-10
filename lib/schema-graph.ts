// Canonical schema.org node identities for archoslabs.xyz.
//
// THE PROBLEM THIS SOLVES
//
// Before this module, every page minted its own anonymous nodes:
//
//   app/layout.tsx      Organization (no @id) + nested founder Person
//                       WebSite (no @id)
//   /about              a SECOND Person (no @id), different jobTitle
//   /blog/[slug]        a THIRD Person (no @id) + an inline Organization
//
// Nothing cross-referenced anything. Google had no way to know these described
// one organisation and its people, so it resolved several unrelated entities
// that happened to share a name — and three different job titles for the same
// human. Structured data was present and plentiful; it just wasn't coherent.
//
// THE FIX
//
// Stable `@id` values, declared once here, referenced everywhere else. A node
// is DECLARED in exactly one place (the layout's @graph) and REFERENCED as
// `{"@id": SCHEMA_IDS.person}` from every other page. That is what turns a pile
// of disconnected fragments into one entity graph.
//
//   #archos-labs ──founder──▶ #rob-angeles
//        ▲                         │
//        │                     worksFor
//        └─────────────────────────┘
//        ▲
//        ├──publisher── #website ──potentialAction──▶ SearchAction
//        └──worksFor─── #metis   (the AI research agent, a SEPARATE person-like
//                                 entity — see personIdForAuthor below)
//
// Adding a node type? Give it an @id here first. A node without one cannot be
// referenced, and an unreferenced node is the problem this module exists for.

import { sameAsFor } from "./social-links";
import type { JsonLd } from "./structured-data";

/**
 * Deliberately the canonical production origin, NOT getSiteUrl().
 *
 * An `@id` is an identifier, not a fetchable address — its job is to be the
 * same string everywhere so references merge into one node. Deriving it from
 * the running host would mint different identities per environment, and a
 * preview deploy's nodes would stop merging with production's. Locally you will
 * therefore see `@id: https://archoslabs.xyz/...` next to
 * `url: http://localhost:3007/...`; that divergence is correct and disappears
 * in production, where the two agree.
 */
const SITE = "https://archoslabs.xyz";

export const SCHEMA_IDS = {
  org: `${SITE}/#archos-labs`,
  person: `${SITE}/#rob-angeles`,
  /**
   * Metis, the blog's AI research agent, is a genuinely distinct entity from
   * the founder and gets its own identity rather than being folded into his.
   * Conflating them would be both factually false and the exact entity-mixing
   * this module removes. See personIdForAuthor.
   */
  metis: `${SITE}/#metis`,
  website: `${SITE}/#website`,
  blog: `${SITE}/blog#blog`,
} as const;

/**
 * One job title, used everywhere.
 *
 * Three shipped before this: "Founder & Principal Practitioner" in the layout,
 * "Principal Consultant" on /about, and none at all on blog posts. Once those
 * nodes share an `@id`, conflicting jobTitle values become contradictory claims
 * about one entity rather than three separate opinions.
 *
 * Changed 2026-08-09 to "Fractional Semantic Data Expert" as part of the
 * positioning consolidation — the site had five different self-descriptions
 * across titles, Service names and this constant. Google resolves an entity
 * more confidently against one repeated jobTitle than several competing ones.
 *
 * Deliberately a constant and not a `site_setting` column: it changes about as
 * often as the company name, and a DB column plus a migration plus an admin
 * input is real permanent complexity to buy nothing. Lift it into settings the
 * day someone needs to change it without a deploy.
 */
export const FOUNDER_JOB_TITLE = "Fractional Semantic Data Expert";

/** A bare reference to a node declared elsewhere in the graph. */
export function ref(id: string): { "@id": string } {
  return { "@id": id };
}

/**
 * Dedupe a `sameAs` list, treating URLs that differ only by a trailing slash
 * or surrounding whitespace as the same identity.
 *
 * A plain `new Set()` is not enough, and the schema.org validator caught it:
 * `site_setting.founderLinkedinUrl` stores the LinkedIn profile without a
 * trailing slash while `lib/social-links.ts` stores it with one, so the merged
 * Person node listed the same profile twice.
 *
 * Harmless to a consumer — Google resolves both to one profile — but `sameAs`
 * is the list asserting "these URLs are this entity", and repeating a member
 * of it is sloppy in exactly the place this module exists to make tidy.
 *
 * Whitespace-only and empty entries are dropped. Order is preserved: the first
 * spelling of a URL wins, so callers control which form ships.
 */
export function dedupeSameAs(urls: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = (raw ?? "").trim();
    if (!url) continue;
    // Compare on a canonical form; emit the caller's original spelling.
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/**
 * Resolve which Person `@id` a blog author maps to.
 *
 * There is currently exactly ONE row in the `author` table and
 * scripts/seed/blog-author-backfill.ts named it "Metis"; every agent post uses
 * the same hardcoded `config.authorId`. So `post.authorName` cannot resolve to
 * the founder, and a founder branch keyed on the author's name would be
 * unreachable code.
 *
 * Promoting a post to the founder is therefore NOT an author-identity question
 * at all — it is a review-status question, answered by `reviewed_by_human_at`,
 * a post-level column that does not exist yet. That belongs with the byline
 * work, not here.
 *
 * Returns undefined for an author this function cannot vouch for, which emits
 * a Person node with no `@id` — anonymous, exactly as it is today, rather than
 * a false identity claim.
 */
export function personIdForAuthor(authorName: string): string | undefined {
  return authorName.trim().toLowerCase() === "metis"
    ? SCHEMA_IDS.metis
    : undefined;
}

/**
 * Wrap nodes in a single `@graph`, hoisting `@context` to the root.
 *
 * Every builder in lib/structured-data.ts and lib/schema-org.ts bakes
 * `"@context"` into its return value so it stays valid standalone. Inside a
 * `@graph` the context belongs once, at the top. Stripping it here rather than
 * editing fourteen builders keeps them independently usable and leaves their
 * existing tests untouched.
 */
export function buildGraph(nodes: JsonLd[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@graph": nodes.map((node) => {
      const { "@context": _dropped, ...rest } = node as Record<string, unknown>;
      void _dropped;
      return rest;
    }),
  };
}

/** The founder. Declared once, in the layout graph. */
export function founderNode(args: {
  founderName: string;
  founderLinkedinUrl: string;
}): JsonLd {
  // The configured LinkedIn wins when set, so the admin can correct it without
  // a deploy; the constant is the fallback rather than a duplicate entry.
  const sameAs = dedupeSameAs([
    args.founderLinkedinUrl,
    ...sameAsFor("person"),
  ]);

  return {
    "@type": "Person",
    "@id": SCHEMA_IDS.person,
    name: args.founderName,
    jobTitle: FOUNDER_JOB_TITLE,
    url: `${SITE}/about`,
    worksFor: ref(SCHEMA_IDS.org),
    sameAs,
    // CDMP is the credential that most directly substantiates the expertise
    // claimed across the site, and it is machine-checkable against DAMA.
    hasCredential: {
      "@type": "EducationalOccupationalCredential",
      credentialCategory: "certification",
      name: "Certified Data Management Professional (CDMP)",
      recognizedBy: {
        "@type": "Organization",
        name: "DAMA International",
      },
    },
  };
}

/**
 * Metis. Typed as a Person because schema.org has no vocabulary for an AI
 * author, and `author` requires Person or Organization — but described
 * honestly, matching the on-page AuthorBio rather than passing it off as human.
 */
export function metisNode(): JsonLd {
  return {
    "@type": "Person",
    "@id": SCHEMA_IDS.metis,
    name: "Metis",
    description:
      "AI research agent at Archos Labs. Researches and drafts articles on AI and data for founders and SMBs.",
    url: `${SITE}/about`,
    worksFor: ref(SCHEMA_IDS.org),
  };
}
