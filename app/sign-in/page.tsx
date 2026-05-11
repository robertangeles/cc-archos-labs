import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Sign in — Archos Labs",
  description: "Open your AI Readiness Assessment report.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/sign-in" },
};

// /sign-in — entry for return visitors who already ran the assessment
// but lost their cookie (cleared browser, switched device, came back
// next month). They enter their email; if we have a lead for it, a
// magic-link email goes out. The form itself doesn't reveal whether
// the email matches — the API returns the same response either way.
//
// First-time visitors should go straight to /tools/ai-readiness;
// there's a back-link in the form for them.

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return <SignInPageInner searchParams={searchParams} />;
}

async function SignInPageInner({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <SignInForm initialError={errorMessage(error)} />;
}

// Map URL ?error= codes to human-friendly messages. The /api/auth/lead/verify
// route redirects here with these codes on failure paths. Codes are
// stable; copy can change in this one place.
function errorMessage(code: string | undefined): string | undefined {
  switch (code) {
    case "expired_link":
      return "That sign-in link has expired or was already used. Enter your email below to send a new one.";
    case "missing_token":
      return "That sign-in link is incomplete. Enter your email below to send a new one.";
    case "no_report":
      return "We couldn't find a report on that account. If this seems wrong, get in touch via the contact form.";
    case "rate_limited":
      return "Too many sign-in attempts from this network. Wait a few minutes and try again.";
    default:
      return undefined;
  }
}
