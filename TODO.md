# 12 plugin — TODO / open questions

## 🔴 Bugs
- **Editing task names — likely fixed, verify.** Root cause was `findLineIndex`
  matching the exact raw line, which broke once markers/text changed or the task
  object went stale. Hardened to match by task *content* (text+indent+bullet).
  Confirm double-click rename + segment triage both work, then close this.

## ✅ Done
- **`[LATER]` triage.** `[LATER]` is now a marker (mutually exclusive with
  `[TODAY]`, never surfaces in Today/Forecast). The Projects view has a per-task
  3-way control (Later · — · Today) for fast triage.
- **Projects view = projects only.** Projects now show as a collapsed list
  (name + today/later/open counts); click a project to expand its tasks with the
  triage control.

## 🟠 Features wanted
- **Editor hotkeys for triage** (deferred — chose project-view-only for now): if
  in-file keyboard triage is wanted later, add "toggle Today" / "toggle Later"
  commands operating on the cursor's task line.

## ✅ Done (recent)
- **Scheduling model simplified.** No due dates. A task surfaces in Today via
  `[TODAY]` (sticky) or a `[tickler:DATE]` (alias `[start:]`) that has arrived.
  `[LATER]` suppresses. Forecast = upcoming ticklers. Recurring advances the
  tickler date. Defer "→" tickles to tomorrow. The `tickler/` folder concept is
  no longer needed (tickler is a token, not a folder).
- **Time-model review done.** `[due:]` removed entirely (type/parser/serializer).
  `tickler/` folder + `includeTicklerFolder` setting removed. `[LATER]` now has a
  real role: in Projects it's a collapsible "Later (N)" someday group, separate
  from the active backlog (neutral). Triage no longer silently wipes a pending
  tickler — neutral keeps a future tickler; only Today/Later consume it. Tickler
  dates show as a chip on triage rows. `[WAITING]` kept; `[start:]` kept as a
  tickler alias.
- **Known edge (low priority):** a `[tickler:]` in a Next Year (parked) or
  WAITING task never fires (promotion skips them) — by design, but document it.

## 🟡 Design decisions needed
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
