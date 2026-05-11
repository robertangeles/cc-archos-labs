import type { Metadata } from "next";
import Link from "next/link";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Check your email — Archos Labs",
  description: "We sent you a sign-in link if your email matched an account.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/sign-in/check-email" },
};

// Confirmation page after POST /api/auth/lead/request. Says the same
// thing whether or not the email matched a lead — no enumeration. The
// email arrives within seconds; if not, the user can try again from
// /sign-in. We surface the email they typed so they can spot a typo.

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const display = email && email.length > 0 && email.length <= 254 ? email : null;

  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <section className="mx-auto w-full max-w-[520px] px-6 pt-24 pb-32 md:px-12 md:pt-32">
        <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">
          Check your inbox
        </p>
        <h1 className="mt-4 text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-fg md:text-4xl">
          We sent you a sign-in link.
        </h1>
        <p className="mt-5 text-base leading-[1.6] text-muted">
          If we have an account for{" "}
          {display ? (
            <span className="text-fg">{display}</span>
          ) : (
            <span>that email</span>
          )}
          , the link is on its way. It expires in 15 minutes and can only be
          used once.
        </p>
        <p className="mt-4 text-base leading-[1.6] text-muted">
          Didn&rsquo;t get it? Check your spam folder, then{" "}
          <Link
            href="/sign-in"
            className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
          >
            try again
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
