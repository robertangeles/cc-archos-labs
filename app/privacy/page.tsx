import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Archos Labs",
  description:
    "What we collect, what we do with it, who we share it with, and how to ask us to delete it. Plain language.",
};

const lastUpdated = "2026-05-08";

export default function PrivacyPage() {
  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <article className="mx-auto w-full max-w-[760px] px-6 pt-24 pb-32 md:px-12">
        <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">
          Privacy
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-[-0.03em] text-fg md:text-[56px]">
          What we do with your data.
        </h1>
        <p className="mt-6 text-[18px] leading-[1.6] text-muted">
          Last updated <time dateTime={lastUpdated}>{lastUpdated}</time>. This
          policy applies to <a href="https://archoslabs.xyz" className="text-accent hover:underline">archoslabs.xyz</a>{" "}
          and is published by Archos Labs Pty Ltd, an Australian company.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-fg">
          What we collect
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-muted">
          We collect only what you give us, plus the minimum metadata needed to
          run the site reliably.
        </p>
        <ul className="mt-6 space-y-3 text-base leading-[1.7] text-muted">
          <li>
            <span className="text-fg">Contact form submissions.</span> Your name,
            email, organisation, and message — when you send us an enquiry.
          </li>
          <li>
            <span className="text-fg">AI Readiness Assessment answers.</span>{" "}
            Your responses to the assessment questions and, on registration,
            your name, work email, job title, and organisation. Phone number is
            optional.
          </li>
          <li>
            <span className="text-fg">Server logs.</span> IP address, request
            timestamp, and user-agent for each request, retained for up to 30
            days for rate-limiting and abuse prevention.
          </li>
        </ul>
        <p className="mt-6 text-base leading-[1.7] text-muted">
          We do not use third-party analytics or advertising trackers. We do
          not collect data about you from anywhere else.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-fg">
          Why we collect it
        </h2>
        <ul className="mt-4 space-y-3 text-base leading-[1.7] text-muted">
          <li>
            To respond to your contact-form enquiry.
          </li>
          <li>
            To generate and deliver your AI Readiness Assessment report.
          </li>
          <li>
            To follow up with you about consulting work, only if you submitted
            a form or completed the assessment.
          </li>
          <li>
            To prevent abuse of public endpoints (rate limiting).
          </li>
        </ul>
        <p className="mt-6 text-base leading-[1.7] text-muted">
          We do not sell your data. We do not rent it. We do not share it with
          marketing partners.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-fg">
          Who else processes it
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-muted">
          We use a small set of service providers. Each only sees the minimum
          data they need to do their job.
        </p>
        <ul className="mt-6 space-y-3 text-base leading-[1.7] text-muted">
          <li>
            <span className="text-fg">Resend</span> — sends transactional email
            (your assessment report, magic-link sign-in). Sees your email
            address and the message we send you.
          </li>
          <li>
            <span className="text-fg">Anthropic</span> — generates the
            practitioner narrative inside your assessment report. Sees your
            assessment answers and a small structured prompt. Does not see your
            name, email, or organisation.
          </li>
          <li>
            <span className="text-fg">Render</span> — hosts the website and
            the database where your assessment, report, and account live.
            Sees the same server logs we do.
          </li>
          <li>
            <span className="text-fg">A CRM (Notion or Airtable)</span> — stores
            your registration details so we can follow up about consulting.
          </li>
        </ul>
        <p className="mt-6 text-base leading-[1.7] text-muted">
          Each of these providers has its own privacy commitments. We pick
          providers we trust to handle your data carefully, but you should know
          your data leaves our servers when these tools do their job.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-fg">
          How long we keep it
        </h2>
        <ul className="mt-4 space-y-3 text-base leading-[1.7] text-muted">
          <li>
            Contact-form submissions and assessment lead records: kept while
            you remain a relevant prospect, deleted on request, and reviewed
            for purging at least once a year.
          </li>
          <li>
            Assessment reports: kept indefinitely while your account exists, so
            you can return and re-read them. Deleted on request.
          </li>
          <li>
            Server logs: 30 days, then purged.
          </li>
        </ul>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-fg">
          Your rights
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-muted">
          Under the Australian Privacy Principles and equivalent laws elsewhere,
          you can ask us to:
        </p>
        <ul className="mt-4 space-y-3 text-base leading-[1.7] text-muted">
          <li>Tell you what we hold about you.</li>
          <li>Correct anything that is wrong.</li>
          <li>Delete it.</li>
          <li>Stop using it for a particular purpose.</li>
        </ul>
        <p className="mt-6 text-base leading-[1.7] text-muted">
          Email{" "}
          <a
            href="mailto:rob.angeles@archoslabs.xyz?subject=Privacy%20request"
            className="text-accent hover:underline"
          >
            rob.angeles@archoslabs.xyz
          </a>
          . We will respond within 30 days.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-fg">
          Cookies
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-muted">
          We use one essential cookie: a session cookie that signs you in to
          your assessment account. It is httpOnly, secure, and expires when you
          sign out. We do not use any other cookies. We do not run third-party
          tracking scripts.
        </p>
        <p className="mt-4 text-base leading-[1.7] text-muted">
          If we ever add privacy-respecting analytics (such as Plausible), we
          will update this page first and tell you here.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-fg">
          Children
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-muted">
          This site is intended for adults working in enterprise contexts. We
          do not knowingly collect data from anyone under 18.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-fg">
          Changes to this policy
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-muted">
          When we update this page, we change the &ldquo;last updated&rdquo;
          date at the top. Material changes that affect existing accounts will
          also be sent by email.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-fg">
          Contact
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-muted">
          Archos Labs Pty Ltd<br />
          Sydney, Australia<br />
          <a
            href="mailto:rob.angeles@archoslabs.xyz"
            className="text-accent hover:underline"
          >
            rob.angeles@archoslabs.xyz
          </a>
        </p>
      </article>
    </main>
  );
}
