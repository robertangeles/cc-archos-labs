// Shared numbered-section header used by the editorial blocks
// (editorial_essay, process_steps, editorial_faq, quick_diagnosis).
//
// Visual move: mono-style "01 · The State of Play" label in lavender at
// the top of each section, on a 12px-tall lavender hairline. Echoes the
// Timeline pattern from the home page (lavender dots on a hairline)
// scaled up to architecture-level section signposting.
//
// Renders as block — usage:
//   <SectionCounter number="01" label="The State of Play" />
//   <h2 className="...">...</h2>

interface SectionCounterProps {
  number: string;
  label: string;
}

export function SectionCounter({ number, label }: SectionCounterProps) {
  return (
    <div className="flex items-center gap-x-3">
      <span
        aria-hidden
        className="block h-px w-12 bg-primary"
      />
      <span className="font-mono text-eyebrow uppercase tracking-[0.2em] text-primary">
        {number} · {label}
      </span>
    </div>
  );
}
