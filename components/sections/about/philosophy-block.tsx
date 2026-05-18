// Philosophy section block — lead pull-quote, supporting prose, optional
// secondary quote.
//
// The lead quote ("The model was never the constraint.") sets the page's
// emotional anchor. Display-size type so it lands as a headline of a belief
// rather than another paragraph. Supporting prose explains. The optional
// secondary quote ("We also believe in telling the truth early.") gets a
// quieter treatment — hairline left rule + headline-size ink.

export type PhilosophyBlockProps = {
  leadQuote: string;
  paragraphs: string[];
  secondaryQuote?: string;
};

export function PhilosophyBlock({
  leadQuote,
  paragraphs,
  secondaryQuote,
}: PhilosophyBlockProps) {
  return (
    <div className="flex flex-col gap-8">
      <blockquote className="text-display-md text-ink md:text-display-lg">
        {leadQuote}
      </blockquote>
      <div className="flex flex-col gap-5 text-body-lg text-ink-subtle">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {secondaryQuote ? (
        <blockquote className="border-l-2 border-primary pl-5 text-headline text-ink">
          {secondaryQuote}
        </blockquote>
      ) : null}
    </div>
  );
}
