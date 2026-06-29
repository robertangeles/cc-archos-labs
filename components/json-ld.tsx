// Safe JSON-LD injector for structured data (SEO). The data is server-built
// (never raw user input), and every "<" in the serialized JSON is escaped to
// its unicode form so the string cannot break out of the <script> element
// (no "</script>", no "<!--"). This is the idiomatic Next.js way to emit
// JSON-LD, hardened against breakout. Centralised here so the dangerous-but-
// required innerHTML lives in exactly one reviewed place.
export function JsonLd({ data }: { data: unknown }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
