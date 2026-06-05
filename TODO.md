# 12 plugin — TODO / open questions

## 🟡 Design decisions needed

### Ticklers — figure out how they're supposed to work
The plugin has an `includeTicklerFolder` setting and a `tickler/` folder
convention, but the actual *behavior* is undefined — right now `tickler/` files
are just indexed like any other included tasks. Decide the model:

- **What is a tickler here?** GTD "tickler file" / 43-folders = date-triggered
  reminders that resurface on a specific future day ("remind me about X on June 15").
- **How is the date encoded?** Options: filename (`tickler/2026-06-15.md`),
  a `[start:YYYY-MM-DD]` / `[due:]` token on the task, or a folder-per-day.
- **When does an item surface?** On its date into **Today**? Into **Forecast**
  ahead of time? Both?
- **Lifecycle when it fires:** does it become a normal task (move out of
  `tickler/`), stay put, or get re-filed? What does "done" mean for a tickler?
- **Then implement it.** Until decided, ticklers behave like ordinary tasks.

### Other open decisions
- **Cycle progress vs. commitments:** the dashboard "This week" column rolls up
  weekly commitments per project. Should the **progress bars** (cycle commitment)
  also auto-advance from commitment completion, or stay manually edited?
- **Archive visibility:** Archive (`projects - archive/`) is fully hidden/unindexed.
  Confirm we never want to list done projects anywhere.
- **Travel/Trips:** dropped from the Projects grouping in the tier refactor.
  `[TRAVEL]` status is still parsed but unused — decide if trips return as a
  concept (own tier? orthogonal flag?).

## 🔵 Grammar to verify against the real vault (inferred from screenshots)
- `**12WY Progress:**` block format (marker line + `- n / m label` bullets).
- Daily-tracker day-label format (`M 06/01`) and `Y` = checked.
- Commitment → project link: now `[[wikilink]]` (preferred), fuzzy `[Tag]`
  fallback. Confirm which your real week files use.
- Errands grouped by `##` headings in `errands.md`.

## 🟢 Tier model (implemented — confirm against real folders)
Folder → tier (relative to the GTD root):
- `projects - this year/` → **This Year** (committed; has a 12WY commitment)
- `projects - ktlo/` → **KTLO** (maintenance tasks only surface)
- `projects - next year/` → **Next Year** (parked; tasks never surface)
- `projects - archive/` → **Archive** (done; never indexed)
- `projects - active/` is kept as a legacy alias for This Year.

Rename your real folders to match (or tell me to keep `active`).

## ⚪ Misc / polish
- Dashboard card counts (Today/Errands) may differ from the old system's numbers — confirm definitions.
- Recurring un-toggle doesn't retract a generated next occurrence (known, low priority).
- Verify Modal edit/confirm + folder-picker on **mobile**.
