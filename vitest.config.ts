import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // CI runs on 2-core runners. Running the heavy pglite integration files in
    // parallel with CPU-bound tests (Sharp image transcode, PII-regex scrubbing)
    // oversubscribes the cores and starves them until they time out — a flaky
    // failure that moves between tests as load shifts. Run files serially in CI
    // for stability; keep full parallelism locally where cores are plentiful.
    fileParallelism: !process.env.CI,
    include: [
      "lib/**/*.test.ts",
      "components/**/*.test.{ts,tsx}",
      "tests/**/*.test.ts",
      "scripts/migrate-wp/**/*.test.ts",
      // Route handler tests sit next to the route.ts they cover. Used
      // by the auth-roles port (lib/auth/* services are too thin to
      // unit-test in isolation; the integration is the contract).
      "app/**/*.test.ts",
    ],
    // Eval suites under tests/eval/ make LIVE Claude calls and incur API
    // cost. They run via `pnpm eval` (a separate vitest config), never
    // in the default test pass / CI. Excluded here so CI stays free.
    exclude: ["node_modules/**", "tests/eval/**"],
  },
  resolve: {
    alias: {
      // `server-only` throws when its client-condition export is picked.
      // Vitest doesn't honour Next.js's server condition, so we point it
      // at a local no-op stub. Tests always run server-side, so this is
      // a faithful resolution. See tests/stubs/server-only.ts.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
      "@/": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
