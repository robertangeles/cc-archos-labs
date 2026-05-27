// Built for / Not for column inside the Who We Work With section.
// Renders a heading + bulleted list. Two of these sit side-by-side on
// desktop, stacked on mobile. Visual separation between the two is the
// parent's job — pre-May-2026 this component drew its own column-divider
// hairline; the SMB rewrite moved each list into its own surface-1 card
// at the page level, so this stays clean and content-only.

type AudienceListProps = {
  variant: "built-for" | "not-for";
  heading: string;
  items: string[];
};

function ListBullet() {
  return (
    <span
      aria-hidden
      className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-subtle"
    />
  );
}

export function AudienceList({ variant, heading, items }: AudienceListProps) {
  return (
    <div data-audience={variant}>
      <h3 className="text-headline text-ink">{heading}</h3>
      <ul className="mt-6 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-x-3 text-body-lg text-ink-muted">
            <ListBullet />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
