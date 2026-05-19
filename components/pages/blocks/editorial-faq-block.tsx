import type { EditorialFaqBlockProps } from "../../../lib/pages/blocks/schemas";

// Editorial FAQ — questions as architectural statements, not chrome.
//
// Drops the "Q —" / "A —" labels (newspaper move). Each question
// renders at display-md, paired with a generous answer column. Big
// vertical spacing between Q&As. Number stamp per question sits as
// a quiet mono accent.
//
// The questions are the load-bearing content. Answer is supporting.

export function EditorialFaqBlock(props: EditorialFaqBlockProps) {
  return (
    <section className="bg-canvas py-24 md:py-32">
      <div className="mx-auto max-w-[1280px] px-6 md:px-12">
        <h2 className="max-w-[1000px] text-display-lg text-ink md:text-display-xl">
          {props.heading}
        </h2>
        {props.leadParagraph ? (
          <p className="mt-8 max-w-[640px] text-body-lg text-ink-subtle">
            {props.leadParagraph}
          </p>
        ) : null}

        <ol className="mt-20 border-t border-hairline">
          {props.items.map((item, idx) => {
            const numeral = `Q.${String(idx + 1).padStart(2, "0")}`;
            return (
              <li
                key={idx}
                className="grid grid-cols-1 gap-x-12 gap-y-8 border-b border-hairline py-16 md:grid-cols-[1fr_2fr] md:py-20 lg:gap-x-20"
              >
                <div>
                  <p className="font-mono text-eyebrow uppercase tracking-[0.2em] text-primary">
                    {numeral}
                  </p>
                  <p className="mt-6 text-display-md leading-[1.15] text-ink md:text-display-md">
                    {item.question}
                  </p>
                </div>
                <p className="max-w-[640px] text-body-lg leading-[1.65] text-ink-subtle md:mt-16">
                  {item.answer}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
