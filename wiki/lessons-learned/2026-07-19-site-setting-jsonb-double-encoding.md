---
title: Writing site_setting.value with JSON.stringify(obj)::jsonb double-encodes it
category: lessons-learned
created: 2026-07-19
updated: 2026-07-19
related: [[brain-prod-cutover]], [[integration-config]]
---

## Problem

A one-off script updated `workspace_chat_prompt` with:
```js
sql`UPDATE site_setting SET value = ${JSON.stringify(newValue)}::jsonb …`
```
`JSON.stringify(newValue)` is already a JSON string; postgres-js then encodes that string **again**, so `::jsonb` stored a jsonb **string** wrapping the object (`"{\"systemPrompt\":…}"`), not a jsonb object. Symptoms: `jsonb_typeof(value)='string'`, `value->>'systemPrompt'` is NULL, and `value.systemPrompt` reads as `undefined`/empty.

The real damage was silent: `getChatPrompt()` does `ChatPromptSchema.safeParse(rows[0].value)`; a string fails the object schema, so it **fell back to the 200-char `CHAT_PROMPT_STARTER` placeholder**. Metis ran without its real IDENTITY/ROLE/SCOPE/injection-defense persona for a while, and nobody noticed because chat + brain recall still worked (recall is independent of the persona).

## Fix

- **Write** a jsonb object with `sql.json(obj)` (postgres-js) — or Drizzle `.insert().values({ value: obj })`, which the app already does. Never `JSON.stringify(obj)::jsonb`.
- **Read** defensively: if `typeof value === "string"`, `JSON.parse` it before using — legacy rows may already be double-encoded (same class of bug the [[integration-config]] loader guards against).

Verified: `SELECT jsonb_typeof(value)` must be `object`, and `value->>'systemPrompt'` must return the text.

## Rule

For any `jsonb` object column: write with `sql.json()` / Drizzle values, never `JSON.stringify(x)::jsonb`; and read with a `typeof === "string"` → `JSON.parse` guard. `scripts/brain-prod-cutover.mjs` does both — copy that pattern for any future `site_setting` writer.
