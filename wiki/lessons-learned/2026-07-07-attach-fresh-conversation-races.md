---
title: Optimistic upload to a just-created conversation loses the file to two client-side races
category: synthesis
created: 2026-07-07
updated: 2026-07-07
related: [[chat-attach-files]]
---

## Problem

The Attach Files PR1 shipped with two latent races that only fired when **attaching to a brand-new conversation** (attach creates the conversation first, like sending does). The manual PR1 smoke test attached to an *existing* conversation, so neither showed — the PR2 Playwright E2E caught both. Symptom: the upload silently never fired, or the chip appeared then vanished mid-upload.

**Race 1 — emptied FileList.** `handleAttachFiles(files: FileList)` iterated the files *after* `await newChat()`:

```ts
async function handleAttachFiles(files: FileList) {
  let convoId = activeConversation?.id ?? null;
  if (!convoId) { const c = await newChat(); convoId = c?.id ?? null; } // <-- await
  for (const file of Array.from(files)) { /* upload */ }               // files is now EMPTY
}
```

`files` is the **live** `HTMLInputElement.files`. The input's `onChange` runs `e.target.value = ""` synchronously right after calling `onAttachFiles(e.target.files)` (needed so the same file can be re-picked). Clearing `value` empties the live FileList. Across the `await`, `Array.from(files)` therefore reads zero files → nothing uploads.

**Race 2 — stale-load clobber.** Creating the conversation makes it active, which fires the "load this conversation's attachments" effect. For a just-created conversation that GET returns `[]`, and it raced the in-flight upload: whichever resolved last won. If the empty load resolved after the optimistic chip was added, `setAttachments([])` wiped it; if it resolved after the upload completed, it dropped the freshly-ready chip. A `merge` instead of `replace` only half-fixed it (a stale empty load could still drop a ready chip) **and** was wrong for genuine conversation switches (it leaked the previous conversation's chips into the new view).

## Fix

1. **Snapshot before the await.** `const fileArr = Array.from(files)` as the first line of `handleAttachFiles`, before `newChat()`; iterate `fileArr`. The array holds real `File` objects, unaffected by the input clearing its FileList.
2. **Consume-once skip ref.** After `newChat()` returns the new id, set `skipAttachLoadRef.current = convoId`. The load effect checks this first and skips exactly that one racing load (clearing the ref), because the client is authoritative for a conversation it just created — the server has nothing to add. Kept the load as a plain `setAttachments(list)` **replace**, which is correct for real conversation switches.

Verified with the E2E run 3× consecutively (green each time) — the fix is not timing-dependent.

## Rule

- When an async handler receives a live DOM collection (`input.files`, `dataTransfer.files`, a live `NodeList`), **snapshot it to an array before the first `await`.** The DOM mutates underneath you across suspension points.
- An optimistic client mutation and a server-load effect targeting the **same** resource will race. Don't reconcile with `merge` — decide who is authoritative. For a resource the client just created, suppress the load; don't let an empty server snapshot clobber local state.
- A manual smoke test that happens to use the pre-existing / warm path will miss bugs on the cold / first-time path. Write the E2E for the path that constructs its own state from zero.
