# 12 — Obsidian 12 Week Year plugin

Native, fast task views for running a [12 Week Year](https://12weekyear.com/) in
Obsidian. Project notes hold tasks in a bracket-token grammar; the plugin
surfaces them into dashboards, a today view, progress tracking, errands, and
more — all rendered natively (no Dataview) and written back to your notes.

## Build & dev

1. `npm install`
2. `npm run build`

The build deploys into two places:

- `.obsidian/plugins/task-12/` — this repo as a dev vault.
- `sample-vault/.obsidian/plugins/task-12/` — a bundled **sample vault** with
  fixture notes, auto-enabled. **Open `sample-vault/` in Obsidian to see every
  view working.**

## Views

Drop a fenced code block into any note:

    ```12 dashboard
    ```

| Query | Renders |
|---|---|
| `12 today` (or bare `12`) | This week's Commitments + Daily Tracker + an "Other" table of everything surfaced for today |
| `12 dashboard` | Card grid (counts link to view notes) + the 12-Week-Year pace table |
| `12 12wy` | Cycle detail: pace table + this week's commitments & tracker |
| `12 errands` | `errands.md` grouped by its `##` category headings |
| `12 forecast` | Upcoming dated tasks grouped This Week / Later This Month / Future Months |
| `12 waiting` | Tasks marked `[WAITING]` |
| `12 projects` | Active projects grouped 12WY / Trips / Other |
| `12 recurring` | Tasks with an `[every:…]` rule |

Dashboard cards open the note that contains the matching `12 <view>` block.

## Task grammar

A task is a normal Markdown checkbox with optional trailing `[bracket]` tokens:

```
- [ ] Draft poems 60–65 [TODAY] [due:2026-06-05] [p:high]
```

- **Status:** `[ ]` todo, `[x]` done, `[/]` in-progress, `[-]` cancelled.
- **Markers:** `[TODAY]`, `[LATER]`, `[WAITING]`, `[ERRANDS]`, `[URGENT]`, `[SOON]`, `[TRAVEL]`. `[TODAY]`/`[LATER]` are the surface/defer states (mutually exclusive); triage them in the Projects view.
- **Dates:** `[due:YYYY-MM-DD]`, `[start:YYYY-MM-DD]`, `[done:YYYY-MM-DD]`.
- **Recurrence:** `[every:1 week]` (`day(s)`/`week(s)`/`month(s)`). Completing a
  recurring task spawns the next occurrence with an advanced due date.
- **Other:** `[p:high|med|low]`, `[id:…]`, `#tags`. Trailing `[[wikilinks]]` are
  left intact.

## File conventions (⚠️ inferred — please verify)

These formats were **inferred from screenshots of the previous system** and may
need adjustment to match your real vault. The `sample-vault/` files are the
canonical examples.

- **Cycle:** `12wy/current.md` contains `**Dates:** YYYY-MM-DD to YYYY-MM-DD`.
- **Weeks:** `12wy/weeks/wNN.md` with a `## Commitments` checkbox list and a
  `## Daily Tracker` markdown table (first column is the day, e.g. `M 06/01`;
  other cells are `Y` or blank). Rows dated after today are hidden; clicking a
  cell toggles `Y`. Each commitment links to its project with a leading
  `[[wikilink]]` (a fuzzy `[Tag]` is also accepted); the dashboard rolls these
  up per project in a "This week" column:

  ```
  - [ ] [[peoples-poems]] Post 10 poems
  ```

- **Project tiers — by folder** (relative to the GTD root):
  - `projects - this year/` → **This Year** (committed 12WY focus)
  - `projects - ktlo/` → **KTLO** (only dated/`[TODAY]` maintenance tasks surface)
  - `projects - next year/` → **Next Year** (parked; tasks never surface)
  - `projects - archive/` → **Archive** (done; never indexed)
  - `projects - active/` is a legacy alias for *This Year*.
- **Commitment = progress target.** A This-Year project declares its cycle
  commitment under a `**12WY Progress:**` marker, one metric per
  `- current / target label` bullet (multiple allowed):

  ```
  **12WY Progress:**
  - 59 / 100 poems posted
  - 1 / 1 intro posted
  ```

- **Errands:** `errands.md` with `##` category headings; each heading becomes a
  group in the errands view.

All paths above are relative to the **GTD folder** (below).

## The `gtd/` folder model

Keep everything the plugin touches inside one folder (e.g. `gtd/`) and point the
plugin at it via **Settings → GTD folder** (a folder picker). Conventional paths
then resolve relative to it — `gtd/12wy/…`, `gtd/projects - active/…`,
`gtd/errands.md`, `gtd/views/…` — so your GTD workspace is self-contained and
droppable into any vault.

**`gtd-template/`** (tracked in this repo) is the canonical starter: copy it into
your vault as `gtd/`, then point the plugin's **GTD folder** setting at it. It
contains the tier folders, view notes, skeleton files, and — importantly — a
**`CLAUDE.md`** that documents the filing conventions **and** defines an editing
boundary for Claude (edit anything inside `gtd/`, nothing outside). Run Claude
Code from inside the folder (`cd <vault>/gtd && claude`) so that boundary is the
default; `gtd/.claude/settings.json` reinforces it.

(`sample-vault/` is a gitignored local test vault with demo data — not the thing
you copy.)

## Settings

- **GTD folder** — folder holding your 12WY data + view notes (empty = whole vault).
- **Include tickler folder** / **Include recurring file** — toggle those sources.

## Known assumptions to confirm

Because the grammar is inferred, the most likely things to differ from your real
setup are: the `**12WY Progress:**` block format, the daily-tracker day-label
format, and whether errands group by `##` headings vs. a marker. Adjust the
parsers (or your files) once you can compare against the real vault.
