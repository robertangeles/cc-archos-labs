import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCRIPT_HOSTS } from "./csp";

// Client code must not violate the CSP that ships with every response.
//
// This exists because the knowledge-base upload page did exactly that, and
// nobody found out until someone tried to upload a book. It called
//
//   Function('return import("https://cdnjs.cloudflare.com/.../pdf.min.mjs")')()
//
// which breaks script-src TWICE over: Function(string) is what 'unsafe-eval'
// governs, and cdnjs is not an allowed host. Both were merely REPORTED while
// the CSP was Report-Only, so the page kept working right up until the policy
// went enforcing — and then failed on a screen nobody visits every day.
//
// A build passes with this in place. Types pass. Tests passed. The only thing
// that catches it is looking for the pattern.

const CLIENT_DIRS = ["../app", "../components", "../hooks"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

// fileURLToPath, not .pathname: this repo lives under a directory with spaces
// in its name, and .pathname hands back percent-encoded "%20" which readdirSync
// cannot open. It fails to an EMPTY file list, so every scan below passes
// vacuously — the exact "green test measuring nothing" failure this file is
// meant to prevent.
const files = CLIENT_DIRS.flatMap((d) =>
  walk(fileURLToPath(new URL(d, import.meta.url))),
);

/** Strip comments so an explanation of a past violation is not read as one. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("client code respects the shipped CSP", () => {
  it("finds files to scan", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  // script-src has no 'unsafe-eval'. Building a function from a string — via
  // Function(), eval(), or a string passed to setTimeout — is blocked at
  // runtime, on the page, in front of the user.
  it("never constructs code from a string", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = code(readFileSync(f, "utf8"));
      if (/\bnew Function\s*\(|(?<![.\w])Function\s*\(\s*['"`]/.test(src)) {
        offenders.push(`${f}: Function(string)`);
      }
      if (/(?<![.\w])eval\s*\(/.test(src)) offenders.push(`${f}: eval()`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  // script-src allows 'self' plus a short host allowlist. A script or worker
  // loaded from anywhere else is blocked — including one fetched by a dynamic
  // import, which is what the pdf.js CDN load was.
  it("never loads a script or worker from a host outside script-src", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = code(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/https:\/\/([a-z0-9.-]+)[^"'`\s]*\.(?:m?js)\b/gi)) {
        const host = m[1];
        const allowed = SCRIPT_HOSTS.some((h) => {
          const bare = h.replace(/^https:\/\//, "").replace(/^\*\./, "");
          return host === bare || host.endsWith(`.${bare}`);
        });
        if (!allowed) offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  // The library itself uses `new Function` on some font/colour-space paths, so
  // bundling it is not sufficient — without this flag it trips the same rule
  // from INSIDE node_modules, which is a far harder error to trace back.
  it("disables pdf.js's internal eval wherever getDocument is called", () => {
    const callers = files.filter((f) => /getDocument\s*\(/.test(code(readFileSync(f, "utf8"))));
    expect(callers.length).toBeGreaterThan(0);
    for (const f of callers) {
      expect(code(readFileSync(f, "utf8")), f).toMatch(/isEvalSupported:\s*false/);
    }
  });
});
