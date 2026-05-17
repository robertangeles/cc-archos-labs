import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
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
    },
  },
});
