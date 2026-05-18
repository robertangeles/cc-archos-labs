-- Seed Privacy + Terms with the corrected legal copy.
--
-- Why this migration exists:
-- The hand-coded /privacy and /terms pages (deleted in the same PR that
-- ships this migration) incorrectly identified Archos Labs as
-- "Pty Ltd, Sydney" — but Archos Labs is a sole trader operating under
-- ABN 18 379 780 858 in Victoria, Australia. This migration replaces
-- that copy with the legally correct version sourced from
-- wiki/decisions/2026-05-18-pages-cms-expansion.md.
--
-- Idempotency: ON CONFLICT (slug) DO NOTHING — re-running the migration
-- is a no-op once both rows exist. To force a re-seed, archive the row
-- in admin then drop it via psql, or update via /admin/pages.
--
-- Pairs with: a page_revision row per page (the "initial seed" revision).
-- The CMS contract is that every page_revision row reflects a save state;
-- the seed counts as a save by the implicit 'system' actor.

-- Dollar-quoted strings (`$MD$ ... $MD$`) let us paste markdown verbatim
-- without escaping single quotes. The tag $MD$ is arbitrary; nothing in
-- the content can collide with it.

WITH privacy_seed AS (
  INSERT INTO "page" (
    slug, title, content_md, excerpt,
    seo_title, seo_description,
    template, status, og_type,
    published_at, last_reviewed_at
  ) VALUES (
    'privacy',
    'Privacy Policy',
    $MD$# Privacy Policy

**Archos Labs**
ABN 18 379 780 858
Victoria, Australia
privacy@archoslabs.xyz

Last updated: May 2026

---

## 1. Who we are

Archos Labs (ABN 18 379 780 858) operates archoslabs.xyz. We provide AI readiness assessment tools and consulting services to organisations in Australia and internationally.

This policy explains what personal information we collect, how we use it, and your rights under the Privacy Act 1988 (Cth) and the Australian Privacy Principles (APPs).

---

## 2. What information we collect

**When you complete the AI Readiness Assessment**

We collect the following information at the registration gate before your report is generated:

- First name and last name
- Email address
- Job title
- Organisation name
- Phone number (optional)
- Your assessment answers (multiple-choice responses only — no free-text fields)
- IP address and browser information at the time of submission

Your sector and role are captured as part of your assessment answers, not as separate fields.

**When you book a call**

If you proceed to book a 30-minute consultation, we collect:

- Your name, email address, organisation, and job title (carried from your assessment registration)
- The reason you are seeking a consultation (free-text, entered at booking)
- Calendar and meeting details via Google Calendar and Google Meet

**When you create an account**

If you create a lead account on the site, we store your name, email, organisation, job title, and phone number, along with your assessment sessions and generated reports.

Account sign-in uses magic links sent to your email address. We do not store passwords.

---

## 3. How we use your information

We use the information you provide to:

- Generate your AI Readiness Assessment report
- Deliver your report by email and make it available on-site
- Send transactional emails related to your assessment and booking (confirmation, reminders, pre-call brief, post-call follow-up)
- Prepare for and conduct your 30-minute consultation
- Determine whether an engagement is a good fit for both parties
- Improve the assessment tool and our services

We do not use your information for unsolicited marketing. We do not sell your data. We do not share your data with advertisers.

---

## 4. How your information is processed for report generation

When you submit your assessment, the following data is sent to OpenRouter (which routes to Anthropic Claude models) to generate your report:

- Your sector and role (from your assessment answers)
- The full set of questions and your selected answers
- Your domain scores, tier classification, and risk flags

Your name, email address, organisation, phone number, job title, IP address, and browser information are not sent to OpenRouter or Anthropic. They remain in our database only.

**What OpenRouter and Anthropic do with this data**

OpenRouter does not log your prompt content or completions by default. It retains only request metadata — timestamps, model used, token counts, and latency. Your assessment answers are not stored by OpenRouter.

Anthropic processes API requests with a 7-day retention window for abuse monitoring purposes. Anthropic does not use API data to train its models.

**Note for healthcare organisations**

The report generation layer (OpenRouter) does not hold a healthcare-specific data processing agreement (such as a US HIPAA Business Associate Agreement or an equivalent Australian health data agreement). If your organisation processes or manages patient health information, you should be aware that assessment data submitted through this tool passes through a routing layer that is not covered by a healthcare data agreement. Contact us at privacy@archoslabs.xyz before completing the assessment if you have questions about this.

---

## 5. Cookies

We use two essential cookies only. We do not use tracking or advertising cookies.

| Cookie | Purpose | Duration |
|---|---|---|
| archos_lead_session | Keeps you signed in to your lead account | 30 days |
| archos_admin_session | Administrator access only | 24 hours |

Both cookies are httpOnly, secure, and sameSite=lax. You cannot opt out of these cookies without losing access to your account.

---

## 6. Analytics

We collect first-party analytics only (page views and scroll depth) using our own event system. We do not use Google Analytics, Hotjar, Mixpanel, Plausible, or any other third-party analytics tool.

---

## 7. Third-party service providers and overseas disclosure

We share data with the following service providers only to the extent necessary to operate the platform. We have entered into data processing agreements with each provider to ensure your information is handled appropriately.

| Provider | Location | Purpose | Data shared |
|---|---|---|---|
| Render | United States | Website and database hosting | All data stored in our database |
| Resend | United States | Transactional email delivery | Name, email address |
| OpenRouter / Anthropic | United States | Report generation | Assessment answers, scores, risk flags (see section 4) |
| Google (Calendar and Meet) | United States | Booking confirmation, calendar invites, video call links | Name, email, organisation, job title, booking reason |

**Cross-border disclosure and your rights**

All four providers listed above are based in the United States. When we disclose your personal information to these providers, your information is transferred to and processed in the United States.

You should be aware that once your personal information is held by an overseas recipient, the Australian Privacy Principles (APPs) will not apply to how that recipient handles your information. The recipient is instead governed by the laws of their own jurisdiction. We have taken reasonable steps to ensure each provider handles your data appropriately by entering into data processing agreements with them, but we cannot guarantee the same level of protection that applies under Australian law.

By submitting your information through this site, you expressly consent to your personal information being transferred to and processed in the United States on the basis described in this section, with the understanding that Australian Privacy Principle protections will not apply to your information once it is held by the overseas recipient.

If you do not consent to overseas transfer, do not submit the assessment or create an account. Contact us at privacy@archoslabs.xyz to discuss alternative options.

---

## 8. Data retention

| Data type | Retention period |
|---|---|
| Lead account and contact details | Retained for 24 months from the date of your last activity with us. Deleted on written request. |
| Assessment responses and reports | Retained while your account exists. Deleted on written request. |
| IP address and browser information | Automatically purged after 30 days. |
| Transactional email records | Retained by Resend for the duration of our service agreement with them. Deleted within 90 days of account termination. |
| Server logs | 30 days |

---

## 9. Your rights

Under the Privacy Act 1988 (Cth) and the Australian Privacy Principles, you have the right to:

- Access the personal information we hold about you
- Request correction of inaccurate or incomplete information
- Request deletion of your information
- Withdraw consent for us to contact you
- Make a complaint about how we have handled your information

To exercise any of these rights, contact us at privacy@archoslabs.xyz. We will respond within 30 days.

If you are located in the European Economic Area, you may also have rights under the General Data Protection Regulation (GDPR) including the right to data portability and the right to lodge a complaint with a supervisory authority in your country.

---

## 10. Security

We take reasonable steps to protect the personal information we hold from misuse, interference, loss, and unauthorised access. This includes:

- Encrypted connections (HTTPS) across the site
- httpOnly and secure cookie flags
- Access controls on database records
- Transactional email sent via verified domain

No method of transmission over the internet is completely secure. We cannot guarantee absolute security.

---

## 11. Children

This site is not directed at individuals under 18 years of age. We do not knowingly collect personal information from minors.

---

## 12. Changes to this policy

We may update this policy from time to time. The date at the top of this page reflects when it was last updated. For material changes to how we collect or use your personal information, we will notify you by email before the change takes effect. Your continued use of the site after a non-material update constitutes acceptance of the revised policy.

---

## 13. Contact and complaints

For privacy enquiries or complaints:

Archos Labs
privacy@archoslabs.xyz
www.archoslabs.xyz

We will acknowledge your complaint within 5 business days and respond within 30 days.

If you are not satisfied with our response, you may contact the Office of the Australian Information Commissioner (OAIC) at oaic.gov.au or by calling 1300 363 992.

---

*This policy applies to personal information collected through archoslabs.xyz and associated services operated by Archos Labs (ABN 18 379 780 858).*
$MD$,
    'What we collect, how we use it, who we share it with, and how to ask us to delete it. Plain language, Australian law.',
    'Privacy Policy',
    'How Archos Labs handles your data — what we collect, why, who processes it, and your rights under the Australian Privacy Principles.',
    'long_form',
    'published',
    'article',
    now(),
    now()
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, title, content_md, seo_title, seo_description
)
INSERT INTO "page_revision" (page_id, title, content_md, seo_title, seo_description, diff_size_pct, saved_by)
SELECT id, title, content_md, seo_title, seo_description, 100.00, 'system-seed'
FROM privacy_seed;

--> statement-breakpoint

WITH terms_seed AS (
  INSERT INTO "page" (
    slug, title, content_md, excerpt,
    seo_title, seo_description,
    template, status, og_type,
    published_at, last_reviewed_at
  ) VALUES (
    'terms',
    'Terms of Service',
    $MD$# Terms of Service

**Archos Labs**
ABN 18 379 780 858
Victoria, Australia
hello@archoslabs.xyz

Last updated: May 2026

---

## 1. Acceptance of terms

By registering for the AI Readiness Assessment, creating an account, or engaging Archos Labs for consulting services, you agree to these Terms of Service. If you do not agree, do not use the site or its tools.

These terms apply to registered users and organisations that engage Archos Labs for consulting services. By completing the assessment registration, you confirm that you have read and agree to these terms. A record of your acceptance is kept with your account.

---

## 2. Who we are

Archos Labs (ABN 18 379 780 858) is a data and AI transformation consultancy operating as a sole trader in Victoria, Australia. We provide AI readiness assessments, data architecture consulting, AI agent development, and training services.

---

## 3. The AI Readiness Assessment

**What it is**

The AI Readiness Assessment is a diagnostic tool that evaluates your organisation''s data foundation, governance posture, and program readiness against the requirements of an AI program. It produces a written report based on your responses.

**What it is not**

The report produced by the assessment is not legal advice, financial advice, regulatory advice, or a technical specification. It is a practitioner''s analysis based on the information you provide. It is designed to inform decisions, not replace them.

The assessment uses AI language models to generate the written analysis in your report. The output reflects the inputs you provide. Archos Labs reviews the scoring and risk flag logic but does not manually review every generated report before delivery. You should exercise your own judgement when acting on the report''s findings.

**Accuracy of inputs**

The quality of the report depends on the accuracy of your responses. Archos Labs accepts no liability for reports generated on the basis of inaccurate, incomplete, or misleading inputs.

**Shareable reports**

Reports can be shared via a link with a 7-day expiry. You are responsible for who you share your report with.

---

## 4. Consulting engagements

**How engagements begin**

Paid consulting engagements do not commence through the website. All engagements begin with a written agreement signed by both parties that sets out scope, deliverables, timeline, and fees. No work commences until that agreement is executed.

**Scope and fees**

Engagements are fixed-scope and fixed-fee unless both parties agree otherwise in writing. Archos Labs does not charge retainers or ongoing access fees outside of a signed engagement agreement.

**Delivery**

Archos Labs delivers consulting services personally. The same consultant who conducts the initial assessment and scoping call performs the engagement work. No work is subcontracted without your written consent.

**Cancellation**

Cancellation terms are set out in your individual engagement agreement. These Terms of Service do not override the terms of a signed engagement agreement.

---

## 5. Intellectual property

**Our materials**

All content on archoslabs.xyz — including the assessment tool, report format, methodology, copy, and design — is the intellectual property of Archos Labs. You may not reproduce, distribute, or commercially exploit any part of it without written permission.

**Your materials**

Any data, documents, or materials you provide to Archos Labs in connection with an engagement remain your property. We use them solely to deliver the services agreed.

**Deliverables**

Unless your engagement agreement states otherwise, you own the deliverables produced for you under a paid engagement once full payment has been received. Archos Labs retains the right to use methodologies and frameworks developed during the engagement in future work, provided all identifying details of your organisation, staff, systems, and data have been removed such that your organisation cannot reasonably be identified from that material.

---

## 6. Confidentiality

Archos Labs treats all information you share — through the assessment, on the call, or during an engagement — as confidential. We do not disclose client information to third parties except as required to deliver the services (see our Privacy Policy) or as required by law.

Confidentiality obligations specific to a consulting engagement are governed by the signed engagement agreement.

---

## 7. Limitation of liability

Nothing in these terms excludes or limits any rights or guarantees you have under the Australian Consumer Law that cannot lawfully be excluded or limited. This includes the consumer guarantee that services will be provided with due care and skill and be reasonably fit for purpose.

Subject to the above, and to the maximum extent permitted by law:

- Archos Labs provides the assessment tool on an "as is" basis. The free AI Readiness Assessment is provided without charge. If Archos Labs is found liable for any loss or damage arising from your use of the free assessment tool, our total liability is limited to AUD $200 or the cost of re-performing the assessment, whichever is greater.
- For paid consulting engagements, our total liability to you is limited to the fees paid for that engagement.
- Archos Labs is not liable for any indirect, consequential, incidental, or special loss or damage arising from your use of the site, the assessment tool, or any consulting services, except where such liability cannot be excluded under the Australian Consumer Law.

---

## 8. Third-party service providers

The site uses the following third-party services to operate. We disclose their use here for transparency. You are not bound by their terms through this document — each provider''s terms govern your relationship with them directly if applicable.

- **Render** — hosting and database. See render.com/privacy.
- **Resend** — transactional email. See resend.com/legal/privacy-policy.
- **OpenRouter / Anthropic** — report generation. See openrouter.ai/privacy and anthropic.com/privacy.
- **Google** — calendar bookings and video calls. See policies.google.com/privacy.

Archos Labs is not responsible for the privacy or data practices of these third-party providers beyond the data processing agreements we hold with each of them, as described in our Privacy Policy.

---

## 9. Acceptable use

You agree not to:

- Use the assessment tool to submit false or misleading information
- Attempt to reverse-engineer, scrape, or extract the assessment logic or scoring methodology
- Use the site in any way that violates applicable law
- Impersonate another person or organisation when completing the assessment

We reserve the right to suspend access to any user or organisation that breaches these terms. Where reasonably practicable, we will notify you of the reason for suspension.

---

## 10. Changes to these terms

We may update these terms from time to time. The date at the top of this page reflects when they were last updated.

For material changes — meaning changes that affect your rights, obligations, or how we handle your information — we will notify registered users by email at least 14 days before the change takes effect. If you do not accept the revised terms, you may close your account before the effective date by contacting us at hello@archoslabs.xyz.

For non-material changes (such as corrections of typographical errors or clarifications that do not alter your rights), your continued use of the site after the change constitutes acceptance.

---

## 11. General

**Severability.** If any provision of these terms is found to be invalid, unlawful, or unenforceable, that provision will be severed from these terms. The remaining provisions will continue in full force and effect.

**Waiver.** A failure or delay by Archos Labs to exercise any right or enforce any provision of these terms does not constitute a waiver of that right or provision.

**Entire agreement.** These terms, together with our Privacy Policy and any signed engagement agreement, constitute the entire agreement between you and Archos Labs in connection with your use of the site and our services. They supersede any prior representations, discussions, or agreements on those matters.

**Assignment.** You may not assign or transfer your rights or obligations under these terms without our prior written consent. Archos Labs may assign these terms to a successor entity in connection with a merger, acquisition, or sale of substantially all of its assets, and will provide you with written notice if this occurs.

---

## 12. Governing law

These terms are governed by the laws of Victoria, Australia. Any disputes arising from these terms or your use of the site will be subject to the exclusive jurisdiction of the courts of Victoria.

---

## 13. Contact

For questions about these terms:

Archos Labs
hello@archoslabs.xyz
archoslabs.xyz
$MD$,
    'Terms for using archoslabs.xyz, the AI Readiness Assessment, and Archos Labs consulting engagements.',
    'Terms of Service',
    'Terms of Service for archoslabs.xyz, the AI Readiness Assessment, and Archos Labs consulting engagements. Governed by Victoria, Australia.',
    'long_form',
    'published',
    'article',
    now(),
    now()
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, title, content_md, seo_title, seo_description
)
INSERT INTO "page_revision" (page_id, title, content_md, seo_title, seo_description, diff_size_pct, saved_by)
SELECT id, title, content_md, seo_title, seo_description, 100.00, 'system-seed'
FROM terms_seed;
