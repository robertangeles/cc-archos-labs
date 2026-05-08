---
title: Phase 2 (AI Readiness Assessment) — CEO review decisions
category: decision
created: 2026-05-08
updated: 2026-05-08
related: [[backlog]], [[index]], [[2026-05-08-admin-deferred]]
---

CEO-mode review of the AI Readiness Assessment Product Spec v1.0 (28pp PDF, supplied 2026-05-08). The spec defines the lead-generation engine that converts executives into qualified leads for the $3,000 AUD AI Readiness Assessment consulting engagement. This decision page records what was held, what was reduced, and the stack alignment to project standards.

## Mode

**HOLD SCOPE** on the spec's product surface — questions, branches, scoring, risk flags, registration gate, full report UI, PDF, share tokens, return-visitor portal, retake flow.

**Sequencing:** Phase 1 and Phase 2 build **in parallel** per Rob's call. Phase 1 (~1 week) ships first to unblock revenue via working contact form; Phase 2 builds alongside (~5 weeks).

## Premise challenges accepted

1. **Three Claude calls → one structured-JSON call.** Three concurrent calls (verdict, narrative, action plan) introduce 3× cost, 3× latency floor, and incoherence risk between sections. A single call returning structured JSON `{verdict, narrative, action_plan[]}` is cheaper, faster, and coherent by construction.

2. **Stack swap to project standards.** Spec specified Supabase (DB + Auth). Project's CLAUDE.md mandates Neon + Drizzle for DB, Resend for email. The spec was written before Claude knew the project standards; standards win. Auth becomes magic-link via Resend (15-minute TTL, single-use, signed JWT in httpOnly cookie). No Supabase dependency.

3. **Server-side PDF (Puppeteer) instead of `window.print()` print stylesheet.** `window.print()` opens a print dialog — the user has to manually "Save as PDF." That is not a one-click PDF download. For a $3k lead-generation tool, the PDF must be reliable, downloadable in one click, and shareable. Puppeteer headless Chromium renders the report page to PDF server-side — same approach unblocks future "email PDF" flows.

4. **Drop sector benchmark bars at MVP.** Spec described benchmarks as "pre-set values, not live data" — i.e. fake. On a tool that markets practitioner truth and no vendor agenda, faked benchmark visualisations are a credibility hole. A skeptical CDO who inspects the bar chart and clocks "this isn't real data" walks. Replace with the verdict statement only. Earn benchmarks back when there are 100+ real submissions.

5. **Staged progress UI replaces 8-second silent wait.** Spec said "no loading spinners visible to the user" between registration submit and report unlock. Eight seconds of blank screen on a dark canvas reads as broken, not magical. Staged progress copy ("Reviewing your answers..." → "Drafting your report..." → "Almost ready...") is honest, sets expectation, and prevents bounce. Costs nothing; eliminates a real abandonment risk.

6. **Old model id updated.** Spec referenced `claude-sonnet-4-20250514` (deprecated). Updated to `claude-sonnet-4-6` per current model availability documented in CLAUDE.md system info.

## Held — built per spec

- 12 base questions (Block 1 context/qualification ×3, Block 2 data diagnostic ×6, Block 3 urgency/accountability ×3) plus 7 conditional branch questions (Q6a, Q6b, Q9a, Q9b, Q9c, Q9d, Q10a). Question wording, answer options, and intent commentary held verbatim — the question design is the actual moat.
- Scoring engine: 0–3 per answer, weighted domain scores (Data Foundation 50% / Program Readiness 30% / Org Reality 20%), tier mapping (Critical / Emerging / Developing / Advanced).
- Risk flag system: up to 3 flags per report, severity-ordered, triggered by specific answer combinations per spec §5.3.
- Hard registration gate: full-screen overlay AFTER final question, report rendered but blurred via `backdrop-filter`. Fields: first/last name, work email, job title, organisation, phone (optional). Email verification happens in background; report unlocks immediately on token verify.
- Report structure: verdict header (one Claude-generated sentence), risk flags, domain score cards (no benchmark bars per the reduction above), Claude practitioner narrative (400–500 words), priority actions (3–5, sequenced, time-horizoned), CTA block adapting tone to Q12 urgency.
- System prompt rules: no journey/leverage/robust/holistic/ecosystem/synergy/transformation; no subheadings; no bullet points in narrative; references the executive's own answers; ends with cost of inaction not opportunity of action.
- 6-page PDF structure: cover + executive summary + practitioner analysis + priority actions + about Archos Labs.
- Share tokens (7-day TTL, single-use revocable, `noindex` headers).
- Return-visitor portal with previous report and 30-day retake cooldown.
- Lead webhook to CRM (Notion or Airtable — Rob's choice) with priority tagging on `urgency_flag = 'mandate'`.

## Stack — final

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 16 App Router, Tailwind v4, Framer Motion |
| Backend | Next.js API routes |
| AI | Anthropic SDK directly (`claude-sonnet-4-6`), prompt caching on system prompt, single call returning structured JSON |
| DB | Neon (serverless Postgres), Drizzle ORM, migrations via drizzle-kit |
| Auth | Magic-link via Resend, JWT in httpOnly cookie, 15-minute token TTL, single-use |
| Email | Resend (transactional report email + magic links) |
| PDF | Puppeteer server-side |
| CRM | Notion or Airtable webhook (Rob to confirm destination) |

## Data model (CLAUDE.md naming standards)

Singular snake_case table names, `id uuid primary key`, foreign keys indexed, `created_at` and `updated_at` on every table, 2NF strict, no transitive dependencies. JSONB permitted for `answers`, `scores`, `risk_flags`, `action_plan` per CLAUDE.md exception clause.

```
assessment_session
  id, started_at, completed_at, answers jsonb, scores jsonb,
  risk_flags jsonb, tier varchar, lead_id uuid (fk indexed),
  created_at, updated_at

report_output
  id, assessment_session_id uuid (fk indexed), verdict text,
  narrative text, action_plan jsonb, generated_at,
  share_token varchar, share_expires_at, created_at, updated_at

lead
  id, first_name, last_name, email varchar (indexed),
  job_title, organisation, phone (nullable), sector,
  role_type, maturity_stage, urgency_flag, overall_score integer,
  tier varchar, is_priority boolean, crm_synced_at,
  created_at, updated_at
```

## What this does NOT decide

- The exact CRM destination (Notion vs Airtable). Rob to confirm before W4.
- Branding decisions for the report (PDF cover styling, exact tier colour palette). Designed during W4–W5.
- Iteration triggers from spec §11.2 (completion rate < 50% etc.) — those are post-launch operational concerns, not build-time decisions.
- Future monetisation of the assessment itself (currently free as a lead-gen tool; spec explicitly does not paywall it).

## Verification

This decision is verified by execution: the items 14–25 in [[backlog]] each carry verify criteria. Phase 2 ships when a cold visitor can complete the assessment, register, receive a Claude-generated report, download it as PDF, and convert to a paid consulting call without human intervention.
