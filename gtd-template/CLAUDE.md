# GTD folder — how to file things (for Claude)

This `gtd/` folder is a self-contained GTD / 12-Week-Year workspace inside a
larger Obsidian vault, rendered by the **`12`** Obsidian plugin. This file tells
you where things go and how to format them. Keep the grammar exact — the plugin
parses it.

## ⛔ Editing boundary (read this first)

- ✅ You **may** read, create, edit, move, and delete files **inside `gtd/`**.
- ⛔ You **must NOT** create, edit, move, or delete **any file outside `gtd/`**.
  Reading outside for context is fine; **writing is not**.
- If a task seems to need a change outside `gtd/`, **stop and ask**.

Run Claude Code with this folder as the working directory (`cd <vault>/gtd &&
claude`) so the boundary is the default; `.claude/settings.json` reinforces it.

## Folder map

```
gtd/
  12wy/current.md          ← active cycle dates
  12wy/weeks/wNN.md        ← weekly commitments + daily tracker
  projects - this year/    ← THIS YEAR (committed 12WY projects)
  projects - ktlo/         ← KTLO (keep the lights on)
  projects - next year/    ← NEXT YEAR (parked, no action this cycle)
  projects - archive/      ← ARCHIVE (done)
  errands.md               ← errands grouped by ## category
  adhoc.md                 ← loose one-off tasks
  inbox.md                 ← unsorted capture (triage later)
  recurring.md             ← recurring tasks
  views/*.md               ← notes holding ```12 <view>``` blocks
```

## Where to file what

- **A loose to-do** with no project → `adhoc.md` (or `inbox.md` if it still
  needs sorting).
- **A task that belongs to a project** → under `## Tasks` in that project's note
  (in whichever tier folder it lives).
- **A shopping/errand item** → under the right `##` category heading in
  `errands.md`. Add a new `## Heading` if no category fits.
- **A recurring task** → `recurring.md`, with an `[every:…]` token.
- **A weekly commitment** → see "Commitments" below. **Never** put commitments
  in project notes — they live only in the current `12wy/weeks/wNN.md`.

## Projects

A project is one note. Tier = **which folder it's in** (move the file to change
tier). Do not use a status token for the tier.

- First line is the display name: `# People's Poems`.
- A **This Year** project states its cycle **goal/commitment** as measurable
  target metric(s) under a `**12WY Progress:**` marker — one per bullet,
  `current / target label` (multiple allowed):

  ```
  # People's Poems

  **12WY Progress:**
  - 59 / 100 poems posted
  - 1 / 1 intro posted

  ## Tasks
  - [ ] Draft poems 60–65 [TODAY]
  ```

- **KTLO / Next Year / Archive** projects don't need a goal. Next Year and
  Archive tasks never surface anywhere — don't rely on them showing up.
- **To re-tier / archive a project, move the file** to the matching folder.

## Commitments (the weekly plan)

In `12wy/weeks/wNN.md` under `## Commitments`, each line is a checkbox that
**must start with a `[[wikilink]]` to its project**:

```
## Commitments
- [ ] [[peoples-poems]] Post 10 poems
- [ ] [[strength-health]] Hit calorie goal 5/7 days
```

The dashboard rolls these up per project. **A commitment with no `[[link]]` is
flagged as an error** ("Needs a project") — always include the link.

The `## Daily Tracker` is a markdown table: first column is the day
(`M 06/01`), other cells are `Y` (done) or blank. Append a row per day.

## Task grammar (exact)

`- [ ] Text [TODAY] [due:2026-06-30] [p:high] [every:1 week]`

- **Status:** `[ ]` todo · `[x]` done · `[/]` in-progress · `[-]` cancelled.
- **Markers:** `[TODAY] [WAITING] [ERRANDS] [URGENT] [SOON] [TRAVEL]`.
- **Dates:** `[due:YYYY-MM-DD] [start:YYYY-MM-DD] [done:YYYY-MM-DD]`.
- **Recurrence:** `[every:1 week]` (`day(s)/week(s)/month(s)`).
- **Other:** `[p:high|med|low] [id:…] #tags`. Trailing `[[wikilinks]]` are kept.
- Tokens go at the **end** of the line. When you complete a task, set `[x]` and
  add `[done:<today>]`.
