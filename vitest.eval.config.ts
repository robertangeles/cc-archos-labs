import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Eval-only Vitest config. Run with `pnpm eval`. Includes ONLY the
// suites under tests/eval/ that make live Claude API calls and incur
// real cost. Default `pnpm test` excludes this directory (see
// vitest.config.ts) so CI stays free and fast.
//
// Cost per run: ~$0.02 across the 15 booking eval cases on Sonnet.
// Negligible per developer but adds up if run in a tight loop — only
// invoke when actually verifying a prompt change.

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/eval/**/*.eval.test.ts"],
    // Live API calls take longer than unit tests — bump the per-test
    // timeout from Vitest's default 5s to 60s.
    testTimeout: 60_000,
    // Single-fork keeps suites sequential to avoid hammering the LLM
    // provider with parallel requests on a single developer's key.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
});
