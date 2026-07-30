---
title: A Report-Only CSP cannot see hosts built at runtime
category: synthesis
created: 2026-07-30
updated: 2026-07-30
related: [[deployment-architecture]], [[2026-07-30-csp-enforcing]], [[2026-07-26-verify-by-running-not-by-deploying]], [[2026-07-12-seo-crawl-not-indexed-hygiene]]
---

The whole point of shipping CSP as Report-Only first is that the violation stream tells you what enforcing would break. It told us almost nothing, and the one thing it hid would have silently killed GA4.

## Problem

The plan was the textbook one: ship `Content-Security-Policy-Report-Only`, collect real violations for a week, build the allowlist from what actually fired, then flip the header name. Two days in, the stream held exactly two reports — one synthetic probe fired to prove delivery worked, and one visitor's browser extension beaconing to an `*.on.aws` endpoint. Nothing first-party. By the stated plan, that reads as a green light.

It was not. Driving a real browser against an *enforcing* copy of the policy found `page_view`, `scroll` and `user_engagement` all posting to `https://www.google.com/g/collect` (`gaf=1`) — with nothing going to `google-analytics.com` on that load at all. Every one blocked. Not degraded, not missing Google Signals: GA4 measurement gone, with the page rendering perfectly and no console error a visitor would ever see.

Three independent checks all missed it:

1. **The report stream.** Never fired for it in two days.
2. **Reading the code.** The original allowlist was written from `components/analytics/*`, and `www.google.com` appears in none of it.
3. **Enumerating hosts in the served HTML.** `curl` across eight pages found seven external hosts and this was not among them.

All three missed it for the same reason: `gtag.js` builds its transport host at runtime. It is not in the source, not in the markup, and — the part that matters — a directive containing `'unsafe-inline'` means the inline script that constructs it never reports either.

## Fix

Added `https://www.google.com` to `connect-src` in [next.config.ts](../../next.config.ts), then re-verified by driving five fresh pages under the enforcing policy: 0 violations, 5 successful `g/collect` hits. Deliberately did not guess at the country-TLD variants (`www.google.com.au` and friends) that GA4 can use for ads cookie sync — nothing requests them today, and `/api/csp-report` is a better detector than a speculative list of Google ccTLDs.

## Rules

**Report-Only tells you about hosts in the markup. A browser tells you about hosts in the traffic.** These are different sets, and the gap is exactly where third-party tags live. Any allowlist for an analytics or tag-manager host must be validated by loading pages in a real browser under an enforcing policy, never by reading the code, the HTML, or the report stream.

**`'unsafe-inline'` blinds the report stream to itself.** With it present, inline scripts never violate, so they never report — which means the reports can never tell you anything about the inline scripts or the hosts they construct. Waiting longer does not fix this; no amount of traffic produces data a directive is structurally incapable of generating. Know which questions your telemetry cannot answer before you plan around it.

**A quiet violation stream is ambiguous, not reassuring.** It means "nothing reported", which could be "nothing broke" or "the thing that breaks is invisible to this instrument" or "no visitor exercised that path". Request logs are not retained on this Render plan, so we could not even distinguish the third. Absence of a signal is only evidence when you have shown the signal would have arrived.

**Enforce against a document, not a server.** CSP binds to the policy a document was delivered with and keeps it for that document's lifetime. A stale tab from before a rebuild reported violations quoting the *old* directive string, which briefly looked like the fix had failed. Reset the browser between policy changes, and read the directive quoted in the violation to confirm which policy produced it.

**The report endpoint earns its keep after the flip, not before.** GTM can inject arbitrary tags at runtime, so no allowlist derived from code can cover what someone adds to the container later. Reporting stays wired on the enforcing policy; `disposition:"enforce"` is now the early warning.
