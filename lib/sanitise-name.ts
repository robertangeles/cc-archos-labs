// Sanitiser for the ?name= URL param consumed by the home page's
// print-personalisation header ("Prepared for {name} · Prepared on {date}").
//
// This is the only user input that flows into the home page render, so it
// gets a strict allow-list rather than an attempt to escape arbitrary input:
//
//   - Must start with a letter
//   - May contain letters, spaces, hyphens, apostrophes
//   - Max 50 chars
//
// Anything outside that pattern returns null so the caller renders the
// "Prepared on {date}" fallback without a name. React's default text
// escaping handles rendering — we never use dangerouslySetInnerHTML on
// this value.
//
// Rationale for not running a more permissive sanitiser (e.g. allowing
// accented Latin characters): real prospects who share the URL with a
// colleague rarely have non-ASCII names; the V1 cost of false negatives
// here is one missed personalisation moment. We can broaden the pattern
// when we have evidence that's a real loss.

const NAME_PATTERN = /^[A-Za-z][A-Za-z\s\-']{0,49}$/;

export function sanitiseName(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  return NAME_PATTERN.test(trimmed) ? trimmed : null;
}
