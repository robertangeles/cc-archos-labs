// Where prospects book a call with Rob. Used by the home page CTA and
// the AI Readiness assessment report's next-step CTA. Centralised so
// the URL can't drift between surfaces when the booking slug changes
// (this exact drift shipped the v1 report pointing at /contact while
// the home page already pointed at the booking flow).
export const BOOK_A_CALL_URL = "/book/archos-labs";
