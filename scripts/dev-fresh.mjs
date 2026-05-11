// Replaces `kill-port 3007 && next dev -p 3007` from the old package.json.
// PORT comes from .env.local (loaded by `node --env-file-if-exists` in the
// invoking script) so each project on the machine can pick its own port
// without two repos colliding on 3007.
//
// Falls back to 3007 if PORT isn't set, matching the documented default.

import killPort from "kill-port";
import { spawn } from "node:child_process";

const port = Number(process.env.PORT ?? 3007);

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
