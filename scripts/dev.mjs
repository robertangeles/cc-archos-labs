// Starts `next dev`. Used by `pnpm dev`.
//
// PORT must be set in .env.local (loaded by `node --env-file-if-exists` in
// the invoking script) — the canonical default `PORT=3007` is documented
// in .env.example. Refuses to start if PORT isn't set so we never silently
// fall through to Next.js's default of 3000 (forbidden by CLAUDE.md).

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

// `--hostname ::` binds the IPv6 wildcard. On Linux with the kernel
// default IPV6_V6ONLY=0, that socket accepts IPv4 connections too
// (IPv4-mapped IPv6), so loopback works whether the browser resolves
// localhost to 127.0.0.1 or ::1. Without this, modern Chromium/Firefox
// can pick ::1 and silently fail when Next's default is IPv4-only.
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--hostname", "::"],
  { stdio: "inherit", env: process.env },
);

child.on("exit", (code) => process.exit(code ?? 0));
