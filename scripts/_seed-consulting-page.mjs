// Seed / update /consulting composed page. Idempotent upsert.
//
// Run: node --env-file=.env.local scripts/_seed-consulting-page.mjs
//
// Composition mirrors the home page section pattern:
//   Hero → Markdown (essay) → Service grid → Timeline (process)
//   → Objection FAQ → Quick Diagnosis → Markdown (final CTA intro) → CtaPair
//
// Every block uses the home page's section components directly so the
// visual language matches what was already shipped on /.

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: "require" });

// ---------------------------------------------------------------------------
// Block props
// ---------------------------------------------------------------------------

const heroProps = {
  eyebrow: "Consulting",
  headline: "Practitioners win the next decade.",
  subhead:
    "Senior data and AI consulting for programs that can't afford to get it wrong. Built by the person who does the work — not the partner who sold it.",
  primaryCta: {
    label: "Start with the assessment",
    href: "/ai-readiness-assessment",
  },
  secondaryCta: {
    label: "Book a 30-minute call",
    href: "/book/archos-labs",
  },
};

const statBandProps = {
  stats: [
    {
      eyebrow: "COBOL Lineage Delivered",
      number: "3",
      unit: "months",
      subtext: "Team estimate was 6 to 9",
    },
    {
      eyebrow: "Cross-Industry Delivery",
      number: "25",
      unit: "years",
      subtext: "Financial services, healthcare, government, retail",
    },
    {
      eyebrow: "Sovereign AI Shipped",
      number: "7",
      unit: "days",
      subtext: "Fine-tuned model, fully offline, $300 hardware",
    },
  ],
};

const honestVersionProps = {
  content: `## The model that built the big consulting firms is breaking.

The large firms industrialised delivery. Thousands of people. Offshore workforces. Long-duration programs priced around hours, headcount, and utilisation. It worked for thirty years.

Generative AI attacks that model directly. If delivery becomes increasingly automated, firms built around monetising vast pools of human capacity have a structural problem. The market has noticed. The layoffs have started.

This creates an opening. Not for another large firm with a smaller logo. For practitioners who never needed the headcount in the first place.

The firms brought in to fix data and AI programs sent a partner to the pitch and a graduate to the delivery. The program got a slide deck. The problem got worse. Archos Labs does not have a delivery bench to protect. Just the work. Scoped honestly, priced fairly, delivered by the same person who diagnosed the problem.

*Smaller. Faster. Accountable.*`,
};

// Service descriptions — trimmed to 3 sentences max each for exec
// scanability. The fuller home-page versions stay on /#services for
// readers who want depth; the CTAs at the bottom of /consulting carry
// the "want more? talk to us" path.
const serviceGridProps = {
  eyebrow: "Services",
  heading: "How we work with you.",
  services: [
    {
      name: "AI Readiness Assessment",
      body: "Two weeks. We map your data foundation, governance, and AI surface area against what your program actually needs. You get a written document your CFO or board can act on — not a framework, not a slide deck.",
      deliverable: "Written Assessment",
    },
    {
      name: "Data Architecture",
      body: "A model is only as good as the data underneath it. We design and build the lineage, domain models, and warehouse structures your AI workloads need to run in production, not in demo conditions. A foundation your CFO can defend and your team can maintain.",
      deliverable: "Data Foundation",
    },
    {
      name: "AI Agent Development",
      body: "Working systems, deployed to your stack, owned by your team. We build AI agents that solve a specific program problem — not proofs of concept that never leave the sandbox. The deliverable is a system in production, not a slide about one.",
      deliverable: "Production System",
    },
    {
      name: "AI & Data Training",
      body: "Hands-on workshops for data and AI teams across the Anthropic ecosystem: Claude Code, Claude Cowork, and production AI agent development. Your team leaves with working knowledge they can apply the next day. Capability, not certificates.",
      deliverable: "Team Workshops",
    },
  ],
};

const timelineProps = {
  heading: "From first call to scoped engagement in two weeks.",
  subtext: "No ambiguity. Here is exactly how this works.",
  milestones: [
    { week: "Day 0", label: "30-minute call. Fit check." },
    { week: "Week 1-2", label: "AI Readiness Assessment." },
    { week: "Week 2", label: "Written report + walkthrough." },
    { week: "Week 3", label: "Scoped engagement letter." },
    { week: "Week 4+", label: "Same practitioner delivers." },
  ],
};

const objectionFaqProps = {
  heading:
    "The questions you will not find answered on a large firm's website.",
  items: [
    {
      question: "You are one person. What happens if something goes wrong?",
      answer: [
        "The same thing that happens inside a large firm — except you do not have to find the person accountable. It is the same person who took your call, ran your assessment, and scoped your engagement.",
        "There is no escalation path because there is no one to escalate past.",
      ],
    },
    {
      question: "What does this cost?",
      answer: [
        "Fixed fee. Scoped before work begins. No retainers. No billing for access. No invoice that grows as the engagement does.",
        "You see the number before we start and it does not move. If the assessment tells us your program needs something outside our scope, we will say so on the call.",
      ],
    },
    {
      question: "What if our data is in COBOL or on legacy systems?",
      answer: [
        "That is a large part of what we do. We delivered full COBOL-to-target lineage at a major health insurer in 3 months. The team estimate was 6 to 9.",
        "Legacy complexity is not a reason to wait. It is the reason to call.",
      ],
    },
  ],
};

const quickDiagnosisProps = {
  eyebrow: "Quick diagnosis",
  heading: "Tell us where you are. We will tell you what is probably wrong.",
  subtext: "Three questions. No email required. One honest answer.",
  disclaimer:
    "This is a general observation based on patterns across programs like yours. The full assessment takes 8 minutes and gives you a scored report your CFO can act on.",
  primaryCta: {
    label: "Take the full assessment",
    href: "/ai-readiness-assessment",
  },
  secondaryCta: {
    label: "Book a 30-minute call",
    href: "/book/archos-labs",
  },
};

const finalCtaIntroProps = {
  content: `## If this sounds like the engagement you have been looking for.

Start with the assessment. Eight minutes. Written report. CFO-ready output. If the score says we should talk, we will invite you to a 30-minute call. Not everyone gets the call. That is the point.`,
};

const finalCtaProps = {
  position: "final",
  align: "center",
  primary: {
    label: "Start with the assessment",
    href: "/ai-readiness-assessment",
    microcopy: "8 min · no login required",
  },
  secondary: {
    label: "Book a 30-minute call",
    href: "/book/archos-labs",
    microcopy: "30 min · we'll tell you if it's not a fit",
  },
};

const blocks = [
  { blockType: "hero", props: heroProps },
  { blockType: "stat_band", props: statBandProps },
  { blockType: "markdown", props: honestVersionProps },
  { blockType: "service_grid", props: serviceGridProps },
  { blockType: "timeline", props: timelineProps },
  { blockType: "objection_faq", props: objectionFaqProps },
  { blockType: "quick_diagnosis", props: quickDiagnosisProps },
  { blockType: "markdown", props: finalCtaIntroProps },
  { blockType: "cta_pair", props: finalCtaProps },
];

const pageRow = {
  slug: "consulting",
  title: "Consulting",
  content_md: "",
  excerpt:
    "Senior data and AI consulting for programs that can't afford to get it wrong. Built by the person who does the work.",
  seo_title: "Consulting",
  seo_description:
    "Senior data and AI consulting for financial services, healthcare, and government. Fixed-fee engagements delivered by the practitioner you talk to. No bench, no junior team, no slide decks.",
  template: "composed",
  status: "published",
  og_type: "website",
};

// ---------------------------------------------------------------------------
// Upsert flow
// ---------------------------------------------------------------------------

try {
  const existing = await sql`SELECT id FROM "page" WHERE slug = ${pageRow.slug}`;
  let pageId;
  if (existing.length === 0) {
    const inserted = await sql`
      INSERT INTO "page" (
        slug, title, content_md, excerpt, seo_title, seo_description,
        template, status, og_type, published_at, last_reviewed_at
      ) VALUES (
        ${pageRow.slug},
        ${pageRow.title},
        ${pageRow.content_md},
        ${pageRow.excerpt},
        ${pageRow.seo_title},
        ${pageRow.seo_description},
        ${pageRow.template},
        ${pageRow.status},
        ${pageRow.og_type},
        now(),
        now()
      )
      RETURNING id
    `;
    pageId = inserted[0].id;
    console.log(`Created /consulting (page id: ${pageId}).`);
  } else {
    pageId = existing[0].id;
    await sql`
      UPDATE "page" SET
        title = ${pageRow.title},
        content_md = ${pageRow.content_md},
        excerpt = ${pageRow.excerpt},
        seo_title = ${pageRow.seo_title},
        seo_description = ${pageRow.seo_description},
        template = ${pageRow.template},
        status = ${pageRow.status},
        og_type = ${pageRow.og_type},
        last_reviewed_at = now(),
        updated_at = now()
      WHERE id = ${pageId}
    `;
    console.log(`Updated /consulting (page id: ${pageId}).`);
  }

  await sql`DELETE FROM "page_block" WHERE page_id = ${pageId}`;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    await sql`
      INSERT INTO "page_block" (page_id, block_type, position, props)
      VALUES (${pageId}, ${b.blockType}, ${i}, ${sql.json(b.props)})
    `;
  }

  const snapshot = blocks.map((b, i) => ({
    blockType: b.blockType,
    position: i,
    props: b.props,
  }));
  await sql`
    INSERT INTO "page_revision" (
      page_id, title, content_md, seo_title, seo_description,
      diff_size_pct, blocks_snapshot, saved_by
    ) VALUES (
      ${pageId},
      ${pageRow.title},
      ${pageRow.content_md},
      ${pageRow.seo_title},
      ${pageRow.seo_description},
      100.00,
      ${sql.json(snapshot)},
      'system-seed'
    )
  `;

  console.log(`Wrote ${blocks.length} blocks + revision snapshot.`);
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
