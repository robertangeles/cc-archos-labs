// One-shot: seed a composed test page so Rob can verify Phase 2 end-to-end
// on return. Idempotent — re-running is a no-op if /phase-2-test exists.
// Delete after Rob's testing pass.
//
// Run: node --env-file=.env.local scripts/_seed-phase2-test-page.mjs

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: "require" });

const heroProps = {
  eyebrow: "Phase 2 test",
  headline: "Composed pages from section blocks.",
  subhead:
    "This page is rendered from rows in page_block, not from a markdown body. Drag-reorder, add, remove blocks in admin and refresh this URL to see changes.",
  primaryCta: {
    label: "Take the assessment",
    href: "/ai-readiness-assessment",
  },
  secondaryCta: {
    label: "Book a call",
    href: "/book/archos-labs",
  },
};

const proofGridProps = {
  eyebrow: "What's testable",
  heading: "Every block path has a regression test.",
  items: [
    {
      label: "Registry",
      outcome:
        "BLOCK_REGISTRY entries map block_type to schema, label, description, and default props. Test asserts each defaultProps satisfies its own schema.",
    },
    {
      label: "Renderer fallback",
      outcome:
        "Unknown block_type and invalid props both render the public placeholder; preview mode surfaces the failing field path.",
    },
    {
      label: "XSS posture",
      outcome:
        "Per-block XSS regression tests pass <script> through every block_type — output renders as escaped text, never executes.",
    },
  ],
};

const serviceGridProps = {
  eyebrow: "How blocks compose",
  heading: "Five block types ship in Phase 2.",
  services: [
    {
      name: "Hero",
      body: "Eyebrow + headline + subhead + optional primary/secondary CTA buttons. The first block on most marketing pages.",
      deliverable: "Section",
    },
    {
      name: "Proof grid",
      body: "Section heading + 1-6 anonymised proof points. Renders 3-up on desktop; stacks on mobile.",
      deliverable: "Grid",
    },
    {
      name: "Service grid",
      body: "Section heading + 1-6 service cards. Each card has name + body + deliverable tag.",
      deliverable: "Grid",
    },
    {
      name: "CTA pair",
      body: "Primary + optional secondary call-to-action band. Use as a closing or mid-page break.",
      deliverable: "Section",
    },
  ],
};

const markdownProps = {
  content: `## What to try

This page lives entirely in the DB. Open \`/admin/pages\`, find **Phase 2 test page**, click Edit.

You should see:

- **Template: Composed (section blocks)** at the top.
- A **Blocks** panel below SEO showing the four blocks composing this page.
- Each block has Up/Down/Remove controls.
- Each block has a JSON props editor (expand by clicking the block header).
- "+ Add block" opens a picker with all five block types.

Try:

1. Reorder blocks (Up / Down).
2. Edit a proof outcome via the JSON editor.
3. Add a CTA pair block at the end.
4. Save the page → refresh \`/phase-2-test\` in another tab.
5. Switch the template back to long-form → the markdown body comes back; the blocks are still stored but ignored at render.
`,
};

const ctaPairProps = {
  position: "final",
  align: "center",
  primary: {
    label: "Back to admin",
    href: "/admin/pages",
  },
  secondary: {
    label: "Open privacy",
    href: "/privacy",
  },
};

try {
  const existing = await sql`SELECT id FROM "page" WHERE slug = 'phase-2-test'`;
  if (existing.length > 0) {
    console.log("/phase-2-test already exists — skipping seed.");
    process.exit(0);
  }

  const inserted = await sql`
    INSERT INTO "page" (
      slug, title, content_md, excerpt, seo_title, seo_description,
      template, status, og_type, published_at, last_reviewed_at
    ) VALUES (
      'phase-2-test',
      'Phase 2 test page',
      '',
      'Throwaway composed page seeded to validate Phase 2 of the Pages CMS. Edit me in /admin/pages.',
      'Phase 2 test page',
      'Composed-template test page for the Pages CMS Phase 2 build.',
      'composed',
      'published',
      'website',
      now(),
      now()
    )
    RETURNING id
  `;
  const pageId = inserted[0].id;

  const blocks = [
    { blockType: "hero", position: 0, props: heroProps },
    { blockType: "proof_grid", position: 1, props: proofGridProps },
    { blockType: "service_grid", position: 2, props: serviceGridProps },
    { blockType: "markdown", position: 3, props: markdownProps },
    { blockType: "cta_pair", position: 4, props: ctaPairProps },
  ];

  for (const b of blocks) {
    await sql`
      INSERT INTO "page_block" (page_id, block_type, position, props)
      VALUES (${pageId}, ${b.blockType}, ${b.position}, ${sql.json(b.props)})
    `;
  }

  await sql`
    INSERT INTO "page_revision" (
      page_id, title, content_md, seo_title, seo_description,
      diff_size_pct, blocks_snapshot, saved_by
    ) VALUES (
      ${pageId},
      'Phase 2 test page',
      '',
      'Phase 2 test page',
      'Composed-template test page for the Pages CMS Phase 2 build.',
      100.00,
      ${sql.json(blocks)},
      'system-seed'
    )
  `;

  console.log(`Seeded /phase-2-test (page id: ${pageId}) with 5 blocks.`);
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
