---
title: Always validate persisted client state on load
category: lessons-learned
created: 2026-06-03
updated: 2026-06-03
related: [[cdmp-practice-exam]]
---

Client-side persisted state (localStorage, sessionStorage) can become stale and cause broken UX.

## Problem

The AI Readiness Assessment persists its state machine phase to localStorage. A user abandoned the assessment at the registration gate, came back later (now authenticated), and the page loaded straight into a registration form with stale/empty answers. The auto-bypass tried to submit the stale answers, the API returned 400, and the form stayed visible with no way out.

## Fix

1. Check answer completeness before auto-submitting from persisted state
2. If persisted state is stale or incomplete, clear it and reset to the initial state
3. If the user is authenticated, skip the registration gate entirely

## Rule

**Every component that loads state from localStorage must validate it on mount.** Check for:
- Empty or incomplete data that makes the persisted phase meaningless
- State that conflicts with current auth status (e.g., registration gate when already logged in)
- Phases that are no longer reachable (stale state machine transitions)

If validation fails, clear the persisted state and reset. Never show a user a form that exists because of stale localStorage.
