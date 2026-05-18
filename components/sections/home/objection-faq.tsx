// Inline objection-handler micro-FAQ. Native <details>/<summary> so the
// disclosure pattern works without any JS — keyboard-accessible by default,
// honours prefers-reduced-motion automatically.
//
// Restrained styling so the FAQ stays a quiet inline element rather than a
// SaaS-y "FAQ section". Each item shows a chevron that rotates on open.
//
// `answer` is a string array — each entry becomes its own <p> so long
// answers can carry deliberate paragraph rhythm.

type FaqItem = {
  question: string;
  answer: string[];
};

type ObjectionFaqProps = {
  items: FaqItem[];
};

export function ObjectionFaq({ items }: ObjectionFaqProps) {
  return (
    <ul className="mt-8 divide-y divide-hairline border-y border-hairline">
      {items.map((item) => (
        <li key={item.question}>
          <details className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-body text-ink hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
              <span>{item.question}</span>
              <span
                aria-hidden
                className="text-ink-tertiary transition-transform duration-150 group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              {item.answer.map((paragraph, i) => (
                <p
                  key={i}
                  className="text-body text-ink-subtle"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
