---
title: LinkedIn API version header sunsets on a ~12-month clock
category: synthesis
created: 2026-07-01
updated: 2026-07-01
related: [[scheduled-social-posts]], [[integration-config]]
---

A hardcoded LinkedIn `LinkedIn-Version` header aged out and silently killed all scheduled LinkedIn auto-posts in production.

## Problem

Scheduled LinkedIn posts started failing in PROD with the UI showing the generic
"LinkedIn API returned no response." The real cause was hidden — `publishToLinkedIn()`
in `lib/social/linkedin.ts` collapses three distinct failure modes (network error,
non-2xx, empty body) into a single `null` return, and the route surfaces only the
generic string. The server log held the truth:

```
[social/linkedin] publish 426: {"status":426,"code":"NONEXISTENT_VERSION","message":"Requested version 20240201 is not active"}
```

`LINKEDIN_API_VERSION` was hardcoded to `"202402"` (Feb 2024). LinkedIn supports each
monthly Marketing/Content API version for a **minimum of 12 months, then sunsets it**.
By July 2026 the latest active version was `202606` and everything before ~`202507`
was retired. Nothing was wrong with the token, scope, or payload — the version string
was simply too old. This was a time bomb set the day the constant was written.

## Fix

Made the version env-overridable with a current default, so it can be bumped from
Render env without a code deploy:

```ts
const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION ?? "202606";
```

Then a failed post recovers via the existing "Retry" button (resets status → pending;
the cron re-publishes with the new header).

## Rule

- Any provider API version pinned as a date/string is a sunsetting time bomb. Pin it
  to an **env var with a current default** and note the sunset policy in a comment, so
  the next expiry is a config change, not an outage + code deploy.
- When a publish/integration "fails silently" with a generic message, **read the
  server log first** — `publishToLinkedIn()` and friends log the real status + body
  (`[social/linkedin] publish <status>: <body>`) before discarding it. Do not guess
  from the UI string.
- Latest active LinkedIn version + sunset policy:
  https://learn.microsoft.com/en-us/linkedin/marketing/versioning

## Follow-up bug (same day): post ID is in a header, not the body

After the version fix, publishing still reported "LinkedIn API returned no
response." Root cause (confirmed by the [Posts API docs](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)):
a successful create returns **`201` with the post URN in the `x-restli-id`
response header** — the body is typically empty. `publishToLinkedIn()` read the
ID from `res.json().id`, so `res.json()` threw on the empty body and returned
`null` → the same generic failure **even though LinkedIn had published the post**.

Because the cron retries up to 3× (`MAX_ATTEMPTS`), this could publish the same
content up to 3 times while marking it failed — i.e. duplicate posts on the feed.

Fix: read `res.headers.get("x-restli-id")` first, fall back to a body `id` only if
the header is absent.

Rule: for LinkedIn REST writes (`/rest/posts`), the created-resource URN comes back
in the `x-restli-id` header (Rest.li convention), **not** the response body. Never
parse the body for the new ID. This applies to any Rest.li `X-Restli-Protocol-Version: 2.0.0`
create — the id is a header.
