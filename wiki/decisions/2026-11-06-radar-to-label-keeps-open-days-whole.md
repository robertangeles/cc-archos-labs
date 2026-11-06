---
title: Radar "To label" keeps a day whole while it has something left to label
category: decision
created: 2026-11-06
updated: 2026-11-06
related: [[news-radar]], [[news-radar-runbook]], [[2026-10-26-news-radar-design-amendments-confirmed]]
---

## Problem

Rob labelled a few stories on `/admin/blog/radar`, went to another page, came back, and the status line said "Today 5 of 24 labelled" with no way to see which five. Confirmed in the code: the To label view returned only unlabelled items (`lib/news-radar/queries.ts`, `loadRadarPage`), so every labelled row left the list on reload. The client kept a just-labelled row on screen only until the next load (DES-D4: "a just-labelled row stays until reload"). Kept and Skipped hold the labelled items, but they are read-only, span every day, and are ordered by score, so they never answered "what did I label today".

## Decision

A day in To label shows all of its eligible stories, labelled and unlabelled, newest first, for as long as at least one story that day is still unlabelled. A day whose stories are all labelled leaves the queue, and "Done for today" still shows when nothing is left anywhere.

- The panel behind "Today 5 of 24 labelled" now holds those 24 rows with 5 marked. Reload gives the same list as before leaving.
- Labelled rows keep their Keep/Skip buttons, so a wrong label can still be switched or cleared after coming back. Before, that was only possible inside the page session (or the 6 second Undo).
- Unchanged: the "To label" pill count and each day's "N to label" still count unlabelled stories only; eligibility, the gate population and the Kept, Skipped, Shortlisted and All views.

## Why this and not the alternatives

- **A link from the status line to a "labelled today" list** needs a new view value in `RADAR_VIEWS` (route validation, pills, copy, tests) and still leaves the list looking different after a reload than before leaving.
- **Always including today** would make "Done for today" unreachable, because today would always have rows.
- **Keeping the old rule** is what made the counter a number with nothing behind it.

## Cost and limit

A day with a few unlabelled stories left shows its labelled ones too, so the page is longer than the pure queue. A story labelled on an older day that is otherwise fully labelled is only visible in Kept or Skipped after a reload. Both accepted; revisit if the page gets too long on a backlog.

Amends DES-D4 of the radar design (the rest of [[2026-10-26-news-radar-design-amendments-confirmed]] stands). Code: `loadRadarPage` to-label branch, test "to-label keeps a day whole while it has something left to label".
