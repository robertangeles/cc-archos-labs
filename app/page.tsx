const CONSULTING_MAILTO =
  "mailto:rob.angeles@archoslabs.xyz?subject=Consulting%20enquiry";

const BUILT_FOR = [
  "Programs in financial services, healthcare, and government where governance isn't optional.",
  "Teams who've sat through enough Big Four presentations to know the difference between advice and accountability.",
  "Executives who need someone in the room who has actually built the thing — not read about it.",
];

const NOT_FOR = [
  "Programs looking to validate a decision that's already been made.",
  "Teams who want a partner logo more than a working system.",
  "Organisations that haven't started thinking about what their data actually looks like.",
];

const SERVICES = [
  {
    name: "AI Readiness Assessment",
    body:
      "Two weeks. We map your data, governance, and AI surface area against what's viable. Written assessment. Not a framework.",
  },
  {
    name: "Data Architecture",
    body:
      "The foundation AI programs keep skipping. Domain modelling, lineage, and warehouse design built for AI workloads — not reporting from 2014.",
  },
  {
    name: "AI Agent Development",
    body:
      "Working systems deployed to your stack, owned by your team. Not demos. The kind of thing that compresses six months of manual work to three.",
  },
];

// Primary lavender (#5e6ad2 → rgb 94, 106, 210) at 12% opacity. Kept as
// a tinted gradient rather than a Tailwind utility because the spec is
// an exact ellipse position + falloff that doesn't map cleanly to a
// utility class. Re-derive RGB from --color-primary if that token ever
// rotates.
const HERO_GRADIENT =
  "radial-gradient(ellipse 80% 60% at 50% 25%, rgba(94, 106, 210, 0.12) 0%, transparent 70%)";

const ctaButtonClass =
  "inline-flex items-center rounded-md bg-primary px-7 py-3 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover";

const sectionHeadingClass =
  "text-[36px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink";

const bodyTextClass = "text-base leading-[1.7] text-ink-subtle";

function BlueDot() {
  return (
    <span
      aria-hidden
      className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
    />
  );
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ backgroundImage: HERO_GRADIENT }}
        />
        <div className="mx-auto flex max-w-[1080px] flex-col items-center px-6 pt-32 pb-12 text-center md:px-12">
          <span className="inline-block rounded-full border border-primary px-3 py-1 text-[13px] font-medium uppercase tracking-[0.08em] text-primary">
            AI Transformation Practice
          </span>
          <h1 className="mt-8 text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-5xl md:text-[80px]">
            Most AI programs <span className="text-primary">fail</span>{" "}
            <br className="hidden sm:inline" />
            before the model arrives.
          </h1>
          <p className="mt-6 max-w-[560px] text-[18px] leading-[1.6] text-ink-subtle">
            Not because the model isn&rsquo;t good enough.
            <br />
            Because the data underneath it was never ready.
          </p>
          <a href={CONSULTING_MAILTO} className={`mt-12 ${ctaButtonClass}`}>
            Book a call
          </a>
        </div>
      </section>

      {/* What we do */}
      <section className="mt-0 bg-surface-1">
        <div className="mx-auto max-w-[1080px] px-6 pt-12 pb-12 md:px-12">
          <h2 className={sectionHeadingClass}>What we do.</h2>
          <p className="mt-5 max-w-[700px] text-pretty text-[20px] font-normal leading-[1.6] text-[#E4E4E7]">
            We don&rsquo;t run pilots. We don&rsquo;t produce slide decks. We
            go into programs that are stuck or at risk and fix the thing
            that&rsquo;s actually broken.
          </p>
          <div className="mt-12 grid items-stretch gap-6 md:grid-cols-3 md:gap-12">
            {SERVICES.map((service) => (
              <article
                key={service.name}
                className="flex h-full flex-col justify-start rounded-lg border border-hairline p-10 transition-colors duration-150 hover:border-primary"
              >
                <h3 className="min-h-[3.25rem] text-[22px] font-medium leading-[1.25] tracking-[-0.01em] text-ink">
                  {service.name}
                </h3>
                <p className="mt-4 text-base leading-[1.7] text-ink-subtle">
                  {service.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Who we work with */}
      <section className="bg-canvas">
        <div className="mx-auto max-w-[1080px] px-6 py-12 md:px-12">
          <h2 className={sectionHeadingClass}>Who we work with.</h2>
          <p className={`mt-5 max-w-[560px] ${bodyTextClass}`}>
            We&rsquo;re built for some programs. Not for others.
          </p>
          <div className="mt-12 grid gap-12 md:grid-cols-2">
            <div className="md:pr-12">
              <h3 className="text-xl font-medium text-ink">Built for</h3>
              <ul className="mt-6 space-y-3">
                {BUILT_FOR.map((item) => (
                  <li
                    key={item}
                    className="flex gap-x-3 text-base leading-[1.8] text-ink-subtle"
                  >
                    <BlueDot />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:border-l md:border-hairline md:pl-12">
              <h3 className="text-xl font-medium text-ink">Not for</h3>
              <ul className="mt-6 space-y-3">
                {NOT_FOR.map((item) => (
                  <li
                    key={item}
                    className="flex gap-x-3 text-base leading-[1.8] text-ink-subtle"
                  >
                    <BlueDot />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-y border-hairline bg-surface-1">
        <div className="mx-auto max-w-[1080px] px-6 py-32 text-center md:px-12">
          <h2 className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-ink md:text-[40px]">
            One call. Thirty minutes.
          </h2>
          <p className={`mx-auto mt-6 max-w-[520px] ${bodyTextClass}`}>
            We&rsquo;ll tell you whether your problem is one we&rsquo;ve solved
            before
            <br />
            and what it would actually cost. No deck. No qualification
            gauntlet.
            <br />
            If we can&rsquo;t help, we&rsquo;ll tell you that too.
          </p>
          <a href={CONSULTING_MAILTO} className={`mt-12 ${ctaButtonClass}`}>
            Book a call
          </a>
        </div>
      </section>
    </main>
  );
}
