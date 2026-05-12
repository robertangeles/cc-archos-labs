// Test stub for the `server-only` package.
//
// `server-only` is a build-time guard from Next.js: when bundled into a
// client component it throws to surface the leak; on the server it
// resolves to an empty module. Vitest doesn't respect Next.js's
// client/server condition, so the import path picks the throwing
// variant by default and breaks any test that touches a server-only
// module (e.g. lib/booking-emails.ts).
//
// Tests always run server-side, so resolving to this empty stub via
// `resolve.alias` in vitest.config.ts is correct.
export {};
