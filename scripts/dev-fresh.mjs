// Kills whatever is on PORT, then starts `next dev`. Used by `pnpm dev:fresh`.
//
// PORT must be set in .env.local (loaded by `node --env-file-if-exists` in
// the invoking script) — the canonical default `PORT=3007` is documented
// in .env.example. Refuses to start if PORT isn't set so we never silently
// fall through to Next.js's default of 3000 (forbidden by CLAUDE.md).

import killPort from "kill-port";
import { spawn, spawnSync } from "node:child_process";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(
    "PORT is not set or invalid. Copy .env.example to .env.local — see CONTRIBUTING.md.",
  );
  process.exit(1);
}

// Pre-flight: nudge if local main is behind origin/main. Non-blocking.
spawnSync(process.execPath, ["scripts/_check-main-sync.mjs", "--dev"], {
  stdio: "inherit",
});

try {
  await killPort(port);
  console.log(`Freed port ${port}`);
} catch {
  // Nothing was on the port — fine.
}

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev"],
  { stdio: "inherit", env: process.env },
);

child.on("exit", (code) => process.exit(code ?? 0));
