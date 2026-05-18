import type { Metadata } from "next";
import { buildPageMetadata } from "../../lib/site-config";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Privacy",
    description:
      "What we collect, what we do with it, who we share it with, and how to ask us to delete it. Plain language.",
    path: "/privacy",
  });
}

const lastUpdated = "2026-05-18";

export default function PrivacyPage() {
  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <article className="mx-auto w-full max-w-[760px] px-6 pt-24 pb-32 md:px-12">
        <p className="uppercase text-eyebrow text-ink-subtle">
          Privacy
        </p>
        <h1 className="mt-4 text-display-md text-ink md:text-display-lg">
          What we do with your data.
        </h1>
        <p className="mt-6 text-[18px] leading-[1.6] text-ink-subtle">
          Last updated <time dateTime={lastUpdated}>{lastUpdated}</time>. This
          policy applies to <a href="https://archoslabs.xyz" className="text-primary hover:underline">archoslabs.xyz</a>{" "}
          and is published by Archos Labs Pty Ltd, an Australian company.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-ink">
          What we collect
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-ink-subtle">
          We collect only what you give us, plus the minimum metadata needed to
          run the site reliably.
        </p>
        <ul className="mt-6 space-y-3 text-base leading-[1.7] text-ink-subtle">
          <li>
            <span className="text-ink">Contact form submissions.</span> Your name,
            email, organisation, and message — when you send us an enquiry.
          </li>
          <li>
            <span className="text-ink">AI Readiness Assessment answers.</span>{" "}
            Your responses to the assessment questions and, on registration,
            your name, work email, job title, and organisation. Phone number is
            optional.
          </li>
          <li>
            <span className="text-ink">Request metadata.</span> IP address and
            browser user-agent are captured when you submit an assessment, for
            rate-limiting and abuse prevention. Cleared from the assessment
            record after 30 days.
          </li>
        </ul>
        <p className="mt-6 text-base leading-[1.7] text-ink-subtle">
          We do not use third-party analytics or advertising trackers. We do
          not collect data about you from anywhere else.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-ink">
          Why we collect it
        </h2>
        <ul className="mt-4 space-y-3 text-base leading-[1.7] text-ink-subtle">
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
        <p className="mt-6 text-base leading-[1.7] text-ink-subtle">
          We do not sell your data. We do not rent it. We do not share it with
          marketing partners.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-ink">
          Who else processes it
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-ink-subtle">
          We use a small set of service providers. Each only sees the minimum
          data they need to do their job.
        </p>
        <ul className="mt-6 space-y-3 text-base leading-[1.7] text-ink-subtle">
          <li>
            <span className="text-ink">Resend</span> — sends transactional email
            (your assessment report, magic-link sign-in). Sees your email
            address and the message we send you.
          </li>
          <li>
            <span className="text-ink">Anthropic</span> — generates the
            practitioner narrative inside your assessment report. Sees your
            assessment answers and a small structured prompt. Does not see your
            name, email, or organisation.
          </li>
          <li>
            <span className="text-ink">Render</span> — hosts the website and
            the database where your assessment, report, and account live.
            Sees the same server logs we do.
          </li>
          <li>
            <span className="text-ink">A CRM (Notion or Airtable)</span> — stores
            your registration details so we can follow up about consulting.
          </li>
        </ul>
        <p className="mt-6 text-base leading-[1.7] text-ink-subtle">
          Each of these providers has its own privacy commitments. We pick
          providers we trust to handle your data carefully, but you should know
          your data leaves our servers when these tools do their job.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-ink">
          How long we keep it
        </h2>
        <ul className="mt-4 space-y-3 text-base leading-[1.7] text-ink-subtle">
          <li>
            <span className="text-ink">Contact-form submissions.</span> We do
            not keep a database copy. Submissions arrive as an email in our
            inbox and live there under our standard inbox retention. Ask us to
            delete the email at any time.
          </li>
          <li>
            <span className="text-ink">Lead accounts and assessment reports.</span>{" "}
            Kept for up to 24 months after your last activity (the most recent
            assessment, sign-in, or profile update). After that, your account,
            assessment answers, and reports are deleted automatically. You can
            ask us to delete them sooner at any time.
          </li>
          <li>
            <span className="text-ink">Request metadata (IP address, browser).</span>{" "}
            Captured with each assessment for rate-limiting and abuse
            prevention, then automatically cleared from the assessment record
            after 30 days. The assessment itself is retained on the schedule
            above.
          </li>
        </ul>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-ink">
          Your rights
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-ink-subtle">
          Under the Australian Privacy Principles and equivalent laws elsewhere,
          you can ask us to:
        </p>
        <ul className="mt-4 space-y-3 text-base leading-[1.7] text-ink-subtle">
          <li>Tell you what we hold about you.</li>
          <li>Correct anything that is wrong.</li>
          <li>Delete it.</li>
          <li>Stop using it for a particular purpose.</li>
        </ul>
        <p className="mt-6 text-base leading-[1.7] text-ink-subtle">
          Email{" "}
          <a
            href="mailto:rob.angeles@archoslabs.xyz?subject=Privacy%20request"
            className="text-primary hover:underline"
          >
            rob.angeles@archoslabs.xyz
          </a>
          . We will respond within 30 days.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-ink">
          Cookies
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-ink-subtle">
          We use essential cookies only. A session cookie signs you in to your
          assessment account; a separate session cookie signs admins in to the
          admin area. Both are httpOnly, secure, and expire on sign-out. We do
          not use any other cookies. We do not run third-party tracking scripts.
        </p>
        <p className="mt-4 text-base leading-[1.7] text-ink-subtle">
          If we ever add privacy-respecting analytics (such as Plausible), we
          will update this page first and tell you here.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-ink">
          Children
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-ink-subtle">
          This site is intended for adults working in enterprise contexts. We
          do not knowingly collect data from anyone under 18.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-ink">
          Changes to this policy
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-ink-subtle">
          When we update this page, we change the &ldquo;last updated&rdquo;
          date at the top. Material changes that affect existing accounts will
          also be sent by email.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-ink">
          Contact
        </h2>
        <p className="mt-4 text-base leading-[1.7] text-ink-subtle">
          Archos Labs Pty Ltd<br />
          Sydney, Australia<br />
          <a
            href="mailto:rob.angeles@archoslabs.xyz"
            className="text-primary hover:underline"
          >
            rob.angeles@archoslabs.xyz
          </a>
        </p>
      </article>
    </main>
  );
}
