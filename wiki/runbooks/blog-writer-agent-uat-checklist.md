---
title: UAT — blog writer agent
category: runbook
created: 2026-07-25
updated: 2026-07-25
related: [[blog-writer-agent]], [[blog-writer-agent-runbook]], [[2026-07-25-no-fabricated-experience]], [[deployment-architecture]]
---

You are deciding one thing: **would you put your name on what this thing writes?**

Everything else — the auth, the kill switch, the publish gate, the crash recovery — is checked by a script. Your job is to read one blog post and answer five questions.

---

## Step 1 — run the checks

Two terminals. First one:

```
pnpm dev
```

Second one:

```
node --env-file=.env.local scripts/uat-blog-agent.mjs
```

Takes about 20 seconds and costs nothing. You should see:

```
  9 of 9 checks passed.
```

<details>
<summary>What those nine checks actually prove</summary>

| Check | Why it matters |
|---|---|
| Blocked when nobody signs in | The endpoint can spend money and create content. It must not be open. |
| Blocked with the wrong password | " |
| Blocked when the password is sent the wrong way | " |
| Stops completely when you switch it off | Your kill switch works. One setting, no deploy. |
| Refuses to run on broken settings | If someone edits the workflow and breaks the wiring, it stops in under a second instead of writing a confident article about nothing. |
| Recovers by itself after a crash | A deploy mid-write leaves a job half-done. It picks itself back up rather than going quiet for a week. |
| An agent post awaiting review is NOT published | **The one control between a draft and your public site.** |
| Your own flagged post still publishes | This change touched shared publishing code. Your own posts must behave exactly as before. |
| Once you approve it, it publishes | Approving actually releases it. |

The script cleans up after itself and leaves your settings as it found them.
</details>

**If anything fails, stop.** Those are controls, not polish. Send me the output.

---

## Step 2 — have it write something

```
node --env-file=.env.local scripts/uat-blog-agent.mjs --write
```

This one costs roughly **$1** and takes **3–6 minutes**. It researches a topic, drafts it, reviews its own work, rewrites once if needed, and hands you a link.

Two outcomes are both fine:

- **"Wrote a post and held it for review"** — go to step 3.
- **"Rejected its own draft and parked it"** — the gate did its job. Read the parked draft anyway and see whether you agree with the rejection.

---

## Step 3 — read it, and answer five questions

Open the link the script prints. Read the whole post.

**1. Would you publish this?**
Yes or no. If no, say specifically what is wrong — that reason becomes the next rule.

**2. Does it claim to have lived through anything?**
Look for *"I spent three months…"*, *"a client asked me…"*, *"last year we…"*. The byline is Metis, which is not a person. A personal war story here is invented, and it is the single fastest way to lose credibility if a reader ever works that out. There should be none.

**3. Is every number real?**
Pick two figures. The script prints a command to show you the research it was given. Each number should be in there. A number that isn't is one it made up.

**4. Does it say "millions" when it means a number?**
Watch for *"drains millions per year"*, *"a significant share"*, *"large portions of their time"*. This is the failure the first live run produced: told its figures weren't supported, it didn't drop them, it made them vaguer. There should be none of this now — if you find one, tell me, because the gate has another hole.

**5. Does the counter-argument get a fair hearing?**
There should be a section arguing against the main point, given real weight and then answered. Not a token objection raised to be swatted away.

---

## The verdict

Ship if the nine checks pass **and** you would publish the post, or you can say precisely why not.

Do not ship if question 2, 3 or 4 turns up anything. Those are the three failures this whole thing exists to prevent.

---

## Things that are known, not broken

Worth knowing so you don't report them as bugs:

- **It never publishes on its own.** Posts land as drafts marked "needs review". They go live when you say so, and not before. That is deliberate — you chose it.
- **It rewrites once, then gives up.** A second rejection parks the post for you. Rewriting until something passes teaches it to dodge the reviewer rather than write better.
- **The number check is matching, not fact-checking.** It catches a figure that appears nowhere in the research. It cannot catch a real figure attached to the wrong claim. That is what question 3 is for.
- **Settings are edited in the database for now.** The admin screens for them come in the next PR.

---

## When you are happy, before PROD

Not part of this test, but the agent cannot run in production until these are done — see [[deployment-architecture]]:

- [ ] Back up PROD, then apply the database change **by hand before merging**. Merging first ships a page that errors on a missing table.
- [ ] Confirm the existing scheduled-post publisher is actually alive in PROD. The whole design assumes it runs.
- [ ] Create the Render cron job — Git Provider source, **not Docker**.
- [ ] Point the settings at PROD, and leave it switched **off** until you have watched a run.
