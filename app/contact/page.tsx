import type { Metadata } from "next";
import { ContactForm } from "../../components/contact/contact-form";
import { buildPageMetadata } from "../../lib/site-config";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Contact",
    description:
      "Tell us what you're working on. We respond within one business day. No pitch, no qualification gauntlet.",
    path: "/contact",
  });
}

export default function ContactPage() {
  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <section className="mx-auto w-full max-w-[760px] px-6 pt-24 pb-32 md:px-12">
        <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">
          Contact
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-[-0.03em] text-fg md:text-[56px]">
          Tell us what&rsquo;s broken.
        </h1>
        <p className="mt-6 max-w-[560px] text-[18px] leading-[1.6] text-muted">
          A few sentences is enough. The more specific, the more useful our
          first reply will be. If we can&rsquo;t help, we&rsquo;ll tell you
          that too.
        </p>

        <div className="mt-12">
          <ContactForm />
        </div>
      </section>
    </main>
  );
}
