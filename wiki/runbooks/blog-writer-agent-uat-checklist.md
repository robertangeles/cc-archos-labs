---
title: UAT — blog writer agent
category: runbook
created: 2026-07-25
updated: 2026-07-26
related: [[blog-writer-agent]], [[blog-writer-agent-runbook]], [[2026-07-25-no-fabricated-experience]], [[deployment-architecture]]
---

You are deciding one thing: **would you put your name on what this thing writes?**

Everything a machine can check, a machine already checked. What is left is judgement, and there are five of them. Budget about twenty minutes.

> **Since you removed the review hold, nothing holds a post back for you.** A post that clears the gate goes live at its slot. That makes the questions below the last human look at this content, not a second opinion after one.

---

## Where this stands right now

Two posts are sitting in DEV, written end to end by the agent this afternoon:

| Publishes | Post |
|---|---|
| 26 Jul, 10:00pm | [The Dashboard Nobody Opens Is Still Costing You](http://localhost:3007/admin/blog/posts/6e152e8a-63f0-4c83-9884-0fb44550627b) |
| 27 Jul, 7:00am | [What a Data Catalog Buys a Ten-Person Company](http://localhost:3007/admin/blog/posts/bab77aac-fbef-47fd-9bd7-63020e458aa7) |

Settings: **on**, three slots a day at 7am / 2pm / 10pm Sydney, 21 posts a week, images on.

Those two are your test material. You do not need to generate more unless you want to.

---

## Step 1 — the machine checks (free, 20 seconds)

```
pnpm dev                                              # terminal 1
node --env-file=.env.local scripts/uat-blog-agent.mjs # terminal 2
```

Expect `9 of 9 checks passed`. These cover auth on the endpoint that spends money, the kill switch, crash recovery, and the publish gate. If any fail, stop and send me the output — those are controls, not polish.

---

## Step 2 — the five judgement calls

Open one of the two posts above. Read it properly, not skimmed.

### 1. Would you publish this under your name?
The whole question. If no, say precisely what is wrong — that reason becomes a rule, the way every other rule in the gate got there.

### 2. Is there a personal story in it that never happened?
Look for *"I spent three months…"*, *"a client asked me…"*, *"I have watched this happen."* The byline is Metis, which is not a person. The gate catches these — it caught exactly that sentence today — but it catches phrasings it knows. A new phrasing gets through.

### 3. Is every number real?

```
node --env-file=.env.local scripts/uat-blog-agent.mjs --research
```

Pick two figures from the post and find them in that output. One you cannot find is one it made up. **This is the check the gate is weakest at**: it matches surface tokens, so it catches a number that appears nowhere, but not a real number attached to the wrong claim.

### 4. Does it go vague where it should be specific?
*"drains millions per year"*, *"a significant share"*, *"large portions of their time."* This is the failure mode the gate was built around: told its figures were unsupported, an early draft did not drop them, it made them blurrier. Should be none now. One means the gate has another hole.

### 5. Would the image stop you scrolling?
Shrink the preview until the image is about a thumb wide. That is how most people meet it.

- **Any text is a hard fail.** Letters, numbers, signage. The model renders legible text whenever a scene implies it.
- **A white border is a hard fail.** It should run edge to edge.
- **Is there an idea in it?** Something quietly wrong — light falling the wrong way, two shadows that disagree. A nice-looking room is decoration, and decoration does not stop a scroll.
- Open both posts side by side. Same palette and drawing style is deliberate. The same *scene* twice is not.

---

## Step 3 — the admin, five minutes

**[/admin/blog/pipeline](http://localhost:3007/admin/blog/pipeline)** — the queue.
Does the top strip tell you whether the agent is alive without you thinking about it? Expand a row via "What the reviewer said" and see whether the rejection reasons are legible.

**[/admin/prompts/blog-agent-config](http://localhost:3007/admin/prompts/blog-agent-config)** — settings and the stop control.
Press **Stop the agent**, then **Start** again. It saves on press with no second click. Safe to try.

Then tell me: is 7am / 2pm / 10pm right, or do you want different times?

---

## The verdict

Ship if the nine checks pass **and** you would publish both posts, or can say exactly why not.

Do not ship if questions 2, 3 or 4 turn anything up. Those are the three failures this whole thing exists to prevent, and there is no longer a human hold behind them.

---

## Open question I need you to settle

**A draft last week contained a literal `[Inference: the research does not establish precise failure thresholds…]` in the prose.** That is the writer showing its working, and it reads as machine output. The gate does not catch it because it is technically an honest caveat rather than a fabrication.

Should a bracketed meta-comment be a hard failure? My view is yes — it is never something a human editor would leave in. Say the word and it becomes a rule.

---

## Things that are known, not broken

- **It publishes on its own.** You removed the review hold and took ownership. To stop one post, flag it for review in the admin — the publisher still withholds a flagged agent post.
- **It rewrites once, then gives up.** A second rejection parks it as a draft, and a draft never publishes. Rewriting until something passes teaches it to dodge the reviewer rather than write better.
- **A parked post is the system working**, not a fault. Two of four rejections today were correct; one was a genuine gate bug, since fixed.
- **One or two internal links per post, sometimes zero.** Links only ever wrap wording the article already used, so a related post that shares no phrasing simply is not linked.
- **The reviewer only sees the finished draft.** It cannot tell you the research was thin, only that the writing is not supported by it. Posts parking repeatedly on one topic means suspect the topic.

---

## When you are happy, before PROD

The agent cannot run in production until these are done — see [[deployment-architecture]]:

- [ ] `pg_dump` PROD, then apply migration `0036` **by hand before merging**. Merging first ships a page that errors on a missing table.
- [ ] Confirm the existing scheduled-post publisher is alive in PROD (`cron_heartbeat` id `posts-publisher`). The whole design assumes it runs.
- [ ] Create the Render cron job — **Git Provider source, not Docker**. Three posts a day means it needs to fire at least three times daily.
- [ ] Re-run `scripts/seed-blog-agent-config.mjs` and `scripts/seed-illustration-skill.mjs --apply` against PROD.
- [ ] Leave it **stopped** until you have watched one run.
