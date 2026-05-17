// Built for / Not for column inside the Who We Work With section.
// Renders a heading + bulleted list. Two of these sit side-by-side on
// desktop, stacked on mobile, with a left-hairline separator on the
// "not-for" column when viewed wide enough.

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
  const columnClass =
    variant === "not-for" ? "md:border-l md:border-hairline md:pl-12" : "md:pr-12";

  return (
    <div className={columnClass}>
      <h3 className="text-card-title text-ink">{heading}</h3>
      <ul className="mt-6 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-x-3 text-body text-ink-subtle">
            <ListBullet />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
