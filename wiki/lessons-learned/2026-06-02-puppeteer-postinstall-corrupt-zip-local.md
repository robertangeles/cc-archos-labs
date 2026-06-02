---
title: Puppeteer's postinstall flakes on a corrupt zip — pre-seed the cache instead of fighting it
category: lessons-learned
created: 2026-06-02
updated: 2026-06-02
related: [[2026-05-13-puppeteer-on-render]]
---

`pnpm install` fails at puppeteer's postinstall on local macOS; the network and download host are fine — pre-seed the Chrome cache with the standalone installer, then re-run install.

## Problem

`pnpm install` failed at the `puppeteer postinstall` step on local macOS (Node 22.22.2, pnpm 10.33.0):

```
.../node_modules/puppeteer postinstall: Error: ERROR: Failed to set up chrome v148.0.7778.97!
  [cause]: Error: All providers failed for chrome 148.0.7778.97:
    - DefaultProvider: end of central directory record signature not found
```

On retry the cause sometimes changed to `ENOENT: ... 148.0.7778.97-chrome-mac-x64.zip`. The failure was **fast** — ~490ms, far too quick to download (let alone corrupt) a 187 MB archive. It left a 0-byte `~/.cache/puppeteer/chrome/mac-148.0.7778.97/` marker directory behind, which made subsequent retries fail the same way (the installer saw the version dir and choked on its empty/corrupt contents).

## What it was NOT (ruled out by evidence)

- **Not the network / download host.** `curl -I` to the Chrome-for-Testing zip returned `HTTP 200`, `content-type: application/zip`, `content-length: 187780021`. A 2 MB ranged `GET` transferred fine.
- **Not disk space.** 331 GB free.
- **Not a proxy / mirror / config override.** No `PUPPETEER_*` env, no `.npmrc`, no `.puppeteerrc`, no `http(s)_proxy`.
- **Not the sandbox.** Reproduced both in-sandbox and in the user's own terminal.

The conclusion by elimination: puppeteer's **bundled postinstall download path** intermittently writes a truncated/0-byte zip and then fails unzipping it. The standalone `@puppeteer/browsers` installer does not have this flakiness — running it directly downloaded the full 356 MB Chrome on the first try.

## Fix

1. Remove the corrupt 0-byte cache marker:
   ```bash
   rm -rf ~/.cache/puppeteer/chrome/mac-148.0.7778.97
   ```
2. Pre-seed the cache with the reliable canonical installer:
   ```bash
   pnpm exec puppeteer browsers install chrome
   ```
3. Re-run `pnpm install`. Postinstall finds the cached browser and prints `chrome (...) downloaded to ...` → `Done`. No shortcut, no `PUPPETEER_SKIP_DOWNLOAD` — puppeteer is fully installed and local PDF export still works.

## Rule

When puppeteer's `postinstall` fails on a corrupt/`end of central directory` zip, **don't fight the postinstall and don't reach for `PUPPETEER_SKIP_DOWNLOAD`** (that's a workaround that silently breaks the local PDF route). Delete the 0-byte cache marker, pre-seed with `pnpm exec puppeteer browsers install chrome`, then re-run install. Before blaming the network, prove it with `curl -I` against the download URL — a sub-second postinstall failure on a 100+ MB browser is an installer bug, not a slow link.

## Relationship to the Render lesson

[[2026-05-13-puppeteer-on-render]] covers the *production/Render* trio (post-install scripts skipped, cache-path mismatch, navigation URL). It explicitly claimed local dev "just works" with puppeteer's defaults — true on Windows, but this is the macOS local-install counter-case. The two together: Render needs an explicit `puppeteer browsers install chrome` in the build command; local macOS sometimes needs the same command run by hand to recover from a corrupt postinstall download.
