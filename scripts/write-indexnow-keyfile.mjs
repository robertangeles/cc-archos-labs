// Generates public/{INDEXNOW_KEY}.txt at build time so IndexNow
// participating engines can verify ownership when they fetch the key
// file at the canonical Option 1 URL: `https://<host>/{key}.txt`.
//
// Wired into the `prebuild` script in package.json so Render writes the
// file during deploy. The contents — and the filename — are the literal
// value of `INDEXNOW_KEY`. The Set-Cookie / Content-Type story is
// handled by Next's static file server at runtime; this script only
// writes raw bytes.
//
// Lifecycle:
//   - INDEXNOW_KEY set + valid     → write public/{key}.txt
//   - INDEXNOW_KEY unset           → no-op (skip silently, so local
//                                    `pnpm build` doesn't need the var)
//   - INDEXNOW_KEY set + invalid   → exit 1 (fail the build)
//
// Re-runs are idempotent. The file is gitignored (public/*.txt) so it
// only ever exists in the build artefact, never in the repo.

import fs from "node:fs";
import path from "node:path";

const key = process.env.INDEXNOW_KEY?.trim();

if (!key) {
  console.log(
    "[indexnow] INDEXNOW_KEY not set — skipping key file generation. " +
      "Pings will no-op at runtime (lib/indexnow.ts also short-circuits).",
  );
  process.exit(0);
}

// IndexNow spec: 8–128 characters, [a-z A-Z 0-9 -].
if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) {
  console.error(
    `[indexnow] INDEXNOW_KEY has invalid format (len=${key.length}). ` +
      `Must be 8–128 characters from [a-zA-Z0-9-]. Failing build to ` +
      `prevent shipping a non-functional IndexNow setup.`,
  );
  process.exit(1);
}

const publicDir = path.resolve(process.cwd(), "public");
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const target = path.join(publicDir, `${key}.txt`);
fs.writeFileSync(target, key, "utf8");
console.log(`[indexnow] wrote ${target} (${key.length} bytes)`);
