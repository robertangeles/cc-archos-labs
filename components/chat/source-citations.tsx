import type { SourceRef } from "@/lib/chat/stream-events";

interface SourceCitationsProps {
  sources: SourceRef[];
}

/**
 * The works an answer was grounded in, shown under it.
 *
 * WHY THIS EXISTS, given Metis already names works in its prose:
 *
 * Prose attribution is a claim. This is the receipt. When Metis writes
 * "Block's point about naming the resistance", there is no way to tell a work
 * it genuinely drew on from one it recalled from training and dressed up as a
 * retrieval. This lists what was ACTUALLY put in front of it — so a work named
 * in the answer but absent here is a fabricated attribution.
 *
 * DESIGN: a footnote, not a badge. Deliberately quiet — no relevance
 * percentages, no chunk previews, no "3 sources" pill. The moment this competes
 * with the answer for attention it stops being something you glance at to check
 * a claim and starts being decoration. Title and author, nothing else.
 *
 * Never rendered for a client-audience turn: `sources` is empty by construction
 * there (lib/chat/stream.ts), because naming a work to a client is the exact
 * disclosure the protection block forbids.
 *
 * NOTE the distinction this does not draw: these are the works RETRIEVED, not
 * the works the answer leant on. Metis may have been given five and used two.
 * "Drew on" would overclaim; "Grounded in" describes the material it had.
 */
export function SourceCitations({ sources }: SourceCitationsProps) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-3 border-t border-hairline pt-2">
      <p className="mb-1 text-xs font-medium tracking-wide text-ink-subtle">
        Grounded in
      </p>
      <ul className="flex flex-col gap-y-0.5">
        {sources.map((s) => (
          <li key={s.title} className="text-xs leading-[1.5] text-ink-subtle">
            <span className="text-ink-muted">{s.title}</span>
            {s.author ? <span> · {s.author}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
