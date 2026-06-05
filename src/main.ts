import {
  AbstractInputSuggest,
  App,
  MarkdownPostProcessorContext,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  debounce,
  setIcon,
} from "obsidian";
import { TaskIndex } from "./index";
import { parseTaskLine, serializeTask } from "./parser";
import type { Task } from "./types";

interface TwelveSettings {
  rootFolder: string;
  includeTicklerFolder: boolean;
  includeRecurringFile: boolean;
}

interface CommitItem {
  lineNumber: number;
  text: string;
  status: string;
  lineText: string;
}

const DEFAULT_SETTINGS: TwelveSettings = {
  rootFolder: "",
  includeTicklerFolder: true,
  includeRecurringFile: true,
};

const ACTIVE_PROJECT_FOLDER = "projects - active/";
const TWELVE_WY_FOLDER = "12wy/";
const TICKLER_FOLDER = "tickler/";
const INCLUDED_FILE_NAMES = new Set(["adhoc.md", "errands.md", "inbox.md", "recurring.md"]);

export default class TwelvePlugin extends Plugin {
  private taskIndex!: TaskIndex;
  settings: TwelveSettings = DEFAULT_SETTINGS;

  // Coalesce bursts of update events (e.g. while typing) into a single preview
  // refresh so we don't re-render every code block on every keystroke.
  private refreshPreview = debounce(() => this.refreshPreviewNow(), 150, false);

  async onload() {
    console.log("Loading 12 plugin");
    await this.loadSettings();
    this.addSettingTab(new TwelveSettingTab(this.app, this));
    await this.initializeTaskIndex();

    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile && file.extension === "md") {
          await this.taskIndex.updateFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("create", async (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.viewNoteMap = null;
          await this.taskIndex.updateFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          this.viewNoteMap = null;
          this.taskIndex.removeFile(oldPath);
          await this.taskIndex.updateFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.viewNoteMap = null;
          this.taskIndex.removeFile(file.path);
        }
      })
    );

    this.registerMarkdownCodeBlockProcessor("12", async (source, el, ctx) => {
      await this.processCodeBlock(source, el, ctx);
    });
  }

  onunload() {
    console.log("Unloading 12 plugin");
  }

  private async initializeTaskIndex() {
    this.taskIndex = new TaskIndex(
      this.app,
      this.settings.rootFolder,
      this.settings.includeTicklerFolder,
      this.settings.includeRecurringFile
    );
    // Each index instance starts with no listeners, so registering here (rather
    // than at every call site) keeps exactly one handler attached and avoids the
    // listener leak that previously accumulated on every settings save.
    this.taskIndex.onUpdate(() => this.refreshPreview());
    await this.taskIndex.loadAll();
  }

  private async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    await this.initializeTaskIndex();
    this.refreshPreview();
  }

  private async processCodeBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    el.empty();
    el.addClass("twelve-view");
    const query = this.resolveQuery(source, el, ctx);
    try {
      switch (query) {
        case "today":
          await this.renderToday(el);
          return;
        case "dashboard":
          await this.renderDashboard(el);
          return;
        case "forecast":
          await this.renderForecast(el);
          return;
        case "errands":
          await this.renderErrands(el);
          return;
        case "waiting":
          await this.renderWaiting(el);
          return;
        case "projects":
          await this.renderProjects(el);
          return;
        case "recurring":
          await this.renderRecurring(el);
          return;
        case "12wy":
          await this.render12WY(el);
          return;
        default:
          this.renderEmpty(el, `Unknown 12 query: ${query}`);
      }
    } catch (error) {
      console.error("[12] Failed to render view", query, error);
      this.renderEmpty(el, "Something went wrong rendering this view. See console for details.");
    }
  }

  // The view name can be authored either inside the block body (`source`) or on
  // the fence's info line (```12 dashboard). Obsidian only passes the body to
  // the processor, so when the body is empty we recover the word from the fence
  // line via the section info. This makes both authoring styles work.
  private resolveQuery(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): string {
    const fromBody = source.trim().split(/\s+/)[0]?.toLowerCase();
    if (fromBody) {
      return fromBody;
    }
    const info = ctx.getSectionInfo(el);
    if (info) {
      const fenceLine = info.text.split("\n")[info.lineStart] ?? "";
      const match = /^\s*`{3,}\s*12\s+(\w+)/.exec(fenceLine);
      if (match) {
        return match[1].toLowerCase();
      }
    }
    return "today";
  }

  // ---------------------------------------------------------------------------
  // Shared UI primitives (refined cream / serif / green design language)
  // ---------------------------------------------------------------------------

  private renderEmpty(container: HTMLElement, message: string) {
    container.createDiv({ cls: "twelve-empty", text: message });
  }

  // A titled section with an uppercase header and an optional count/ratio badge.
  private section(container: HTMLElement, title: string, badge?: string | number): HTMLElement {
    const section = container.createDiv({ cls: "twelve-section" });
    const header = section.createDiv({ cls: "twelve-section-header" });
    header.createSpan({ cls: "twelve-section-title", text: title });
    if (badge !== undefined && badge !== "") {
      header.createSpan({ cls: "twelve-badge", text: String(badge) });
    }
    return section.createDiv({ cls: "twelve-section-body" });
  }

  private iconButton(parent: HTMLElement, icon: string, tooltip: string, onClick: () => void | Promise<void>) {
    const button = parent.createEl("button", { cls: "twelve-icon-button" });
    button.setAttr("aria-label", tooltip);
    button.setAttr("title", tooltip);
    setIcon(button, icon);
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await onClick();
    });
    return button;
  }

  private progressBar(parent: HTMLElement, ratio: number, variant: string) {
    const track = parent.createDiv({ cls: "twelve-bar" });
    const fill = track.createDiv({ cls: `twelve-bar-fill twelve-bar-${variant}` });
    fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  private checkbox(parent: HTMLElement, checked: boolean, onToggle: () => void | Promise<void>): HTMLInputElement {
    const cb = parent.createEl("input", { cls: "twelve-check" });
    cb.type = "checkbox";
    cb.checked = checked;
    cb.addEventListener("change", () => onToggle());
    return cb;
  }

  private projectName(fileName: string): string {
    return fileName.replace(/\.md$/i, "");
  }

  // A project's display name (its H1 title) — consistent everywhere a project is
  // shown, rather than the raw filename slug.
  private projectTitle(filePath: string): string {
    const meta = this.taskIndex.getMeta(filePath);
    if (meta?.title) {
      return meta.title;
    }
    const name = filePath.split("/").pop() ?? filePath;
    return this.projectName(name);
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/['’]/g, "") // drop apostrophes so "People's" → "peoples"
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // Resolve a human commitment label (e.g. "Strength", "People's Poems") to the
  // path of the matching project note ("strength-health.md", "peoples-poems.md").
  private resolveProjectPath(label: string): string | null {
    const slug = this.slugify(label);
    if (!slug) {
      return null;
    }
    const first = slug.split("-")[0];
    const candidates = this.taskIndex
      .getSnapshots()
      .filter((s) => !this.isCycleInfrastructure(s.filePath))
      .map((s) => ({ path: s.filePath, slug: this.slugify(this.projectName(s.fileName)) }));
    return (
      candidates.find((c) => c.slug === slug)?.path ??
      candidates.find((c) => c.slug.startsWith(`${slug}-`))?.path ??
      candidates.find((c) => c.slug.split("-")[0] === first)?.path ??
      null
    );
  }

  // Render `text` as a link that opens `filePath`, wired to Obsidian's
  // hover-preview so hovering shows the note popover.
  private fileLink(parent: HTMLElement, filePath: string, text: string, extraClass?: string) {
    const cls = extraClass ? `twelve-link ${extraClass}` : "twelve-link";
    const link = parent.createEl("a", { cls, text, href: filePath });
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(file);
      }
    });
    link.addEventListener("mouseover", (event) => {
      this.app.workspace.trigger("hover-link", {
        event,
        source: "12-plugin",
        hoverParent: parent,
        targetEl: link,
        linktext: filePath,
      });
    });
    return link;
  }

  // A project shown as a pill: a link when the note exists, plain pill otherwise.
  private projectPill(parent: HTMLElement, label: string, filePath: string | null, extraClass = "") {
    const cls = `twelve-pill ${extraClass}`.trim();
    if (filePath) {
      this.fileLink(parent, filePath, label, cls);
    } else {
      parent.createSpan({ cls, text: label });
    }
  }


  // ---------------------------------------------------------------------------
  // Cycle + task helpers
  // ---------------------------------------------------------------------------

  private async getCurrentCycle(): Promise<
    { weekNumber: number; weekFile: TFile | null; weekPath: string; start: string; end: string } | null
  > {
    const currentFile = this.app.vault.getAbstractFileByPath(this.resolvePath("12wy/current.md"));
    if (!(currentFile instanceof TFile)) {
      return null;
    }
    const content = await this.app.vault.cachedRead(currentFile);
    const dates = this.parseCurrentDates(content);
    if (!dates) {
      return null;
    }
    const startDate = this.parseDateToken(dates.start);
    if (!startDate) {
      return null;
    }
    const today = this.normalizeDate(new Date());
    const weekNumber = Math.min(Math.max(this.compute12WYWeek(startDate, today), 1), 13);
    const weekPath = this.resolvePath(`12wy/weeks/w${weekNumber.toString().padStart(2, "0")}.md`);
    const weekAbstract = this.app.vault.getAbstractFileByPath(weekPath);
    const weekFile = weekAbstract instanceof TFile ? weekAbstract : null;
    return { weekNumber, weekFile, weekPath, start: dates.start, end: dates.end };
  }

  // Tasks to surface in the "today" list: visible today (or completed today so a
  // just-checked item lingers with a strikethrough), excluding cycle scaffolding
  // (the 12wy/ folder, whose commitments are rendered separately).
  private getSurfacedTasks(): Task[] {
    const today = this.normalizeDate(new Date());
    const todayToken = this.formatDateToken(new Date());
    return this.taskIndex
      .getTasks()
      .filter((task) => !this.isExcludedPath(task.filePath))
      .filter((task) => !this.isCycleInfrastructure(task.filePath))
      .filter(
        (task) => this.isVisibleToday(task, today) || (task.status === "done" && task.done === todayToken)
      );
  }

  private isCycleInfrastructure(path: string): boolean {
    const root = this.getNormalizedRootFolder();
    const prefix = root ? `${root}/` : "";
    const rel = root && path.startsWith(prefix) ? path.slice(prefix.length) : path;
    return rel.startsWith("12wy/");
  }

  private sortTasks(tasks: Task[]): Task[] {
    const rank: Record<string, number> = { high: 0, med: 1, low: 2 };
    return [...tasks].sort((a, b) => {
      const pa = a.priority ? rank[a.priority] : 3;
      const pb = b.priority ? rank[b.priority] : 3;
      if (pa !== pb) {
        return pa - pb;
      }
      const da = a.due ? this.parseDateToken(a.due)?.getTime() ?? Infinity : Infinity;
      const db = b.due ? this.parseDateToken(b.due)?.getTime() ?? Infinity : Infinity;
      if (da !== db) {
        return da - db;
      }
      return a.text.localeCompare(b.text);
    });
  }

  // ---------------------------------------------------------------------------
  // Today
  // ---------------------------------------------------------------------------

  private async renderToday(container: HTMLElement) {
    const cycle = await this.getCurrentCycle();

    if (cycle?.weekFile) {
      const weekContent = await this.app.vault.cachedRead(cycle.weekFile);
      const commitments = this.parseListSection(weekContent, "## Commitments");
      const tracker = this.parseTableSection(weekContent, "## Daily Tracker");
      this.renderCommitments(container, cycle.weekFile, cycle.weekNumber, commitments);
      this.renderTracker(container, cycle.weekFile, tracker);
    }

    const surfaced = this.getSurfacedTasks();
    const openCount = surfaced.filter((task) => task.status !== "done").length;
    const body = this.section(container, "Other", openCount || undefined);
    if (!surfaced.length) {
      this.renderEmpty(body, "Nothing else surfaced for today.");
      return;
    }
    this.renderTaskTable(body, this.sortTasks(surfaced), { actions: true, showProject: true });
  }

  private renderCommitments(container: HTMLElement, file: TFile, weekNumber: number, items: CommitItem[]) {
    const done = items.filter((item) => item.status === "done").length;
    const body = this.section(
      container,
      `Week ${weekNumber} Commitments`,
      items.length ? `${done}/${items.length}` : undefined
    );
    if (!items.length) {
      this.renderEmpty(body, "No commitments found for this week.");
      return;
    }
    this.renderCheckList(body, file, items);
  }

  private renderTracker(
    container: HTMLElement,
    file: TFile,
    tracker: { header: string[]; rows: string[][]; rowLines: number[] }
  ) {
    const body = this.section(container, "Tracker — Week So Far");
    if (!tracker.header.length || !tracker.rows.length) {
      this.renderEmpty(body, "No daily tracker table found.");
      return;
    }

    const today = this.normalizeDate(new Date());
    const todayToken = this.formatDateToken(today);
    const table = body.createEl("table", { cls: "twelve-tracker" });

    const headRow = table.createEl("thead").createEl("tr");
    tracker.header.forEach((column, idx) => {
      const th = headRow.createEl("th", { text: column });
      if (idx === 0) {
        th.addClass("twelve-tracker-day");
      }
    });

    const tbody = table.createEl("tbody");
    tracker.rows.forEach((row, rowIndex) => {
      const dayDate = this.parseDateToken(row[0]) || today;
      if (dayDate.getTime() > today.getTime()) {
        return; // don't render days that haven't happened yet
      }
      const tr = tbody.createEl("tr");
      if (this.formatDateToken(dayDate) === todayToken) {
        tr.addClass("is-today");
      }
      row.forEach((cell, cellIndex) => {
        if (cellIndex === 0) {
          tr.createEl("td", { cls: "twelve-tracker-day", text: cell });
          return;
        }
        const td = tr.createEl("td", { cls: "twelve-tracker-cell" });
        const checked = cell.trim().toUpperCase() === "Y";
        this.checkbox(td, checked, async () => {
          const lineIndex = tracker.rowLines[rowIndex];
          if (lineIndex === undefined) {
            return;
          }
          await this.updateTrackerCell(file, lineIndex, cellIndex, checked ? "" : "Y");
        });
      });
    });
  }

  // A checkbox list with write-back and a styled leading [Tag] chip.
  private renderCheckList(body: HTMLElement, file: TFile, items: CommitItem[]) {
    if (!items.length) {
      this.renderEmpty(body, "Nothing here.");
      return;
    }
    const list = body.createDiv({ cls: "twelve-list" });
    for (const item of items) {
      const row = list.createDiv({ cls: "twelve-row" });
      if (item.status === "done") {
        row.addClass("is-done");
      }
      this.checkbox(row, item.status === "done", () => this.toggleListLine(file, item));
      const textWrap = row.createDiv({ cls: "twelve-row-text" });
      const tagMatch = /^\[([^\]]+)\]\s*(.*)$/.exec(item.text);
      if (tagMatch) {
        const path = this.resolveProjectPath(tagMatch[1]);
        const label = path ? this.projectTitle(path) : tagMatch[1];
        this.projectPill(textWrap, label, path, "twelve-pill-inline");
        textWrap.createSpan({ text: tagMatch[2] });
      } else {
        textWrap.createSpan({ text: item.text });
      }
    }
  }

  // The task table used by Today/Forecast/Waiting/Projects/Recurring.
  private renderTaskTable(
    body: HTMLElement,
    tasks: Task[],
    opts: { actions?: boolean; showProject?: boolean; showDue?: boolean }
  ) {
    const table = body.createEl("table", { cls: "twelve-task-table" });
    const tbody = table.createEl("tbody");
    for (const task of tasks) {
      const tr = tbody.createEl("tr", { cls: "twelve-task-tr" });
      if (task.status === "done") {
        tr.addClass("is-done");
      }

      const checkCell = tr.createEl("td", { cls: "twelve-cell-check" });
      this.checkbox(checkCell, task.status === "done", () => this.toggleTaskDone(task));

      const textCell = tr.createEl("td", { cls: "twelve-cell-text" });
      textCell.createSpan({ text: task.text });
      for (const marker of task.markers) {
        if (marker === "TODAY") {
          continue;
        }
        textCell.createSpan({ cls: "twelve-pill twelve-pill-marker", text: marker.toLowerCase() });
      }
      textCell.setAttr("title", "Double-click to edit");
      textCell.addEventListener("dblclick", () => this.editTaskText(task));

      if (opts.showDue) {
        const meta = tr.createEl("td", { cls: "twelve-cell-meta" });
        const rel = task.due ? this.relativeDate(task.due) : null;
        if (rel) {
          const due = meta.createSpan({ cls: `twelve-due twelve-due-${rel.tone}`, text: rel.text });
          due.setAttr("title", task.due!);
        }
      }
      if (opts.showProject) {
        const projectCell = tr.createEl("td", { cls: "twelve-cell-project" });
        this.projectPill(projectCell, this.projectTitle(task.filePath), task.filePath);
      }
      if (opts.actions) {
        const actions = tr.createEl("td", { cls: "twelve-cell-actions" }).createDiv({ cls: "twelve-actions" });
        this.iconButton(actions, "corner-up-left", "Remove from today", async () => {
          await this.removeMarkerFromTask(task, "TODAY");
        });
        this.iconButton(actions, "arrow-right", "Defer to tomorrow", async () => {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          await this.deferTask(task, this.formatDateToken(tomorrow));
        });
        this.iconButton(actions, "x", "Delete", () => this.deleteTask(task));
      }
    }
  }

  private async renderForecast(container: HTMLElement) {
    const today = this.normalizeDate(new Date());
    const tasks = this.taskIndex
      .getTasks()
      .filter((task) => task.due && task.status !== "done" && task.status !== "cancelled")
      .filter((task) => !this.isExcludedPath(task.filePath) && !this.isCycleInfrastructure(task.filePath))
      .sort((a, b) => {
        const aDate = this.parseDateToken(a.due!);
        const bDate = this.parseDateToken(b.due!);
        return (aDate?.getTime() ?? Infinity) - (bDate?.getTime() ?? Infinity);
      });

    if (!tasks.length) {
      this.renderEmpty(this.section(container, "Forecast"), "No upcoming tasks found.");
      return;
    }

    const groups = new Map<string, Task[]>();
    for (const task of tasks) {
      const group = this.getForecastGroup(task, today);
      const bucket = groups.get(group) ?? [];
      bucket.push(task);
      groups.set(group, bucket);
    }

    for (const title of ["This Week", "Later This Month", "Future Months"]) {
      const groupTasks = groups.get(title);
      if (!groupTasks?.length) {
        continue;
      }
      const body = this.section(container, title, groupTasks.length);
      this.renderTaskTable(body, groupTasks, { showDue: true, showProject: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  private async renderDashboard(container: HTMLElement) {
    const cycle = await this.getCurrentCycle();

    const tasks = this.taskIndex.getTasks();
    const open = (task: Task) => task.status !== "done" && task.status !== "cancelled";
    const visiblePath = (path: string) => !this.isExcludedPath(path) && !this.isCycleInfrastructure(path);
    const visible = (task: Task) => visiblePath(task.filePath);

    const todayCount = this.getSurfacedTasks().filter((task) => task.status !== "done").length;
    const waitingCount = tasks.filter((t) => visible(t) && open(t) && t.markers.includes("WAITING")).length;
    const errandCount = await this.countErrands();
    const forecastCount = tasks.filter((t) => visible(t) && open(t) && !!t.due).length;
    const recurringCount = this.getRecurringTasks().length;
    const projectCount = this.taskIndex
      .getSnapshots()
      .filter((s) => visiblePath(s.filePath) && s.tasks.some(open)).length;
    const wyCount = this.taskIndex.getSnapshots().filter((s) => s.meta.is12WY).length;

    const grid = container.createDiv({ cls: "twelve-dash-grid" });
    this.dashCard(grid, "Today", todayCount, "today");
    this.dashCard(grid, "12WY", wyCount, "12wy");
    this.dashCard(grid, "Projects", projectCount, "projects");
    this.dashCard(grid, "Waiting", waitingCount, "waiting");
    this.dashCard(grid, "Errands", errandCount, "errands");
    this.dashCard(grid, "Forecast", forecastCount, "forecast");
    this.dashCard(grid, "Recurring", recurringCount, "recurring");

    this.render12WYTable(container, cycle?.weekNumber ?? 1);
  }

  private dashCard(grid: HTMLElement, title: string, count: number, view: string) {
    const card = grid.createDiv({ cls: "twelve-card" });
    card.createSpan({ cls: "twelve-card-title", text: title });
    if (count > 0) {
      card.createSpan({ cls: "twelve-badge", text: String(count) });
    }
    card.addEventListener("click", () => this.openView(view));
  }

  private render12WYTable(container: HTMLElement, weekNumber: number) {
    const projects = this.taskIndex
      .getSnapshots()
      .filter((s) => s.meta.is12WY)
      .sort((a, b) => a.fileName.localeCompare(b.fileName));

    const body = this.section(container, "12 Week Year");
    if (!projects.length) {
      this.renderEmpty(body, "No 12WY projects found.");
      return;
    }

    const table = body.createEl("table", { cls: "twelve-wy-table" });
    const headRow = table.createEl("thead").createEl("tr");
    headRow.createEl("th", { text: "Project" });
    headRow.createEl("th", { text: "Progress (done / target)" });
    headRow.createEl("th", { cls: "twelve-wy-open", text: "Open" });

    const tbody = table.createEl("tbody");
    for (const project of projects) {
      const tr = tbody.createEl("tr");
      const nameCell = tr.createEl("td", { cls: "twelve-wy-name" });
      this.projectPill(nameCell, this.projectTitle(project.filePath), project.filePath);

      const progCell = tr.createEl("td", { cls: "twelve-wy-progress" });
      if (!project.meta.progress.length) {
        progCell.createSpan({ cls: "twelve-faint", text: "—" });
      } else {
        for (const metric of project.meta.progress) {
          const line = progCell.createDiv({ cls: "twelve-metric" });
          const label = metric.label ? ` ${metric.label}` : "";
          line.createSpan({ cls: "twelve-metric-label", text: `${metric.current} / ${metric.target}${label}` });
          const expected = Math.max(1, Math.round((weekNumber / 12) * metric.target));
          const variant = this.paceVariant(metric.current, expected);
          this.progressBar(line, metric.target ? metric.current / metric.target : 0, variant);
        }
      }

      const openTasks = project.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled").length;
      tr.createEl("td", { cls: "twelve-wy-open", text: String(openTasks) });
    }
  }

  private paceVariant(current: number, expected: number): string {
    const ratio = expected > 0 ? current / expected : 1;
    return ratio >= 1 ? "good" : ratio >= 0.75 ? "warning" : "danger";
  }

  // ---------------------------------------------------------------------------
  // View-note navigation (dashboard cards open the note holding that view block)
  // ---------------------------------------------------------------------------

  private viewNoteMap: Map<string, string> | null = null;

  private async openView(view: string) {
    const file = await this.findViewNote(view);
    if (file) {
      await this.app.workspace.getLeaf(false).openFile(file);
    } else {
      new Notice(`No note containing a \`12 ${view}\` block was found.`);
    }
  }

  private async findViewNote(view: string): Promise<TFile | null> {
    if (!this.viewNoteMap) {
      await this.buildViewNoteMap();
    }
    const path = this.viewNoteMap?.get(view);
    if (!path) {
      return null;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private async buildViewNoteMap() {
    const map = new Map<string, string>();
    const fenceRe = /(?:^|\n)\s*`{3,}\s*12\s+(\w+)/g;
    for (const file of this.app.vault.getMarkdownFiles()) {
      let content: string;
      try {
        content = await this.app.vault.cachedRead(file);
      } catch {
        continue;
      }
      if (!content.includes("```")) {
        continue;
      }
      fenceRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = fenceRe.exec(content)) !== null) {
        const name = match[1].toLowerCase();
        if (!map.has(name)) {
          map.set(name, file.path);
        }
      }
    }
    this.viewNoteMap = map;
  }

  // ---------------------------------------------------------------------------
  // Waiting + Errands
  // ---------------------------------------------------------------------------

  private async renderWaiting(container: HTMLElement) {
    const tasks = this.taskIndex
      .getTasks()
      .filter((task) => task.markers.includes("WAITING") && task.status !== "done" && task.status !== "cancelled")
      .filter((task) => !this.isExcludedPath(task.filePath) && !this.isCycleInfrastructure(task.filePath));

    const body = this.section(container, "Waiting", tasks.length || undefined);
    if (!tasks.length) {
      this.renderEmpty(body, "Nothing is waiting.");
      return;
    }
    this.renderTaskTable(body, this.sortTasks(tasks), { showProject: true });
  }

  private async renderErrands(container: HTMLElement) {
    const path = this.resolvePath("errands.md");
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.renderEmpty(this.section(container, "Errands"), `Unable to locate ${path}.`);
      return;
    }
    const content = await this.app.vault.cachedRead(file);
    const sections = this.parseHeadingSections(content);
    if (!sections.length) {
      this.renderEmpty(this.section(container, "Errands"), "No errand sections found.");
      return;
    }
    for (const sec of sections) {
      const open = sec.items.filter((item) => item.status !== "done").length;
      const body = this.section(container, sec.title.toUpperCase(), open || undefined);
      this.renderCheckList(body, file, sec.items);
    }
  }

  // Parse a markdown file into heading-delimited sections of checkbox items.
  private parseHeadingSections(text: string): Array<{ title: string; items: CommitItem[] }> {
    const lines = text.split(/\r?\n/);
    const sections: Array<{ title: string; items: CommitItem[] }> = [];
    let current: { title: string; items: CommitItem[] } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const headingMatch = /^#{2,6}\s+(.*)$/.exec(lines[i]);
      if (headingMatch) {
        current = { title: headingMatch[1].trim(), items: [] };
        sections.push(current);
        continue;
      }
      const taskMatch = /^\s*[-*]\s*\[([ xX/\-])\]\s*(.*)$/.exec(lines[i]);
      if (taskMatch && current) {
        current.items.push({
          lineNumber: i,
          text: taskMatch[2],
          status: taskMatch[1].toLowerCase() === "x" ? "done" : "todo",
          lineText: lines[i],
        });
      }
    }

    return sections.filter((sec) => sec.items.length > 0);
  }

  private async countErrands(): Promise<number> {
    const file = this.app.vault.getAbstractFileByPath(this.resolvePath("errands.md"));
    if (!(file instanceof TFile)) {
      return 0;
    }
    const content = await this.app.vault.cachedRead(file);
    return this.parseHeadingSections(content).reduce(
      (sum, sec) => sum + sec.items.filter((item) => item.status !== "done").length,
      0
    );
  }

  // ---------------------------------------------------------------------------
  // Projects + Recurring
  // ---------------------------------------------------------------------------

  private async renderProjects(container: HTMLElement) {
    // Drive project grouping off the cached index snapshots so we don't re-read
    // every project file from disk on each render.
    const projectEntries = this.taskIndex
      .getSnapshots()
      .filter((snapshot) => !this.isExcludedPath(snapshot.filePath) && !this.isCycleInfrastructure(snapshot.filePath))
      .map((snapshot) => ({
        filePath: snapshot.filePath,
        fileName: snapshot.fileName,
        is12WY: snapshot.meta.is12WY,
        isTravel: snapshot.meta.isTravel,
        tasks: snapshot.tasks.filter((task) => task.status !== "done" && task.status !== "cancelled"),
      }))
      .filter((project) => project.tasks.length > 0);

    if (!projectEntries.length) {
      this.renderEmpty(this.section(container, "Projects"), "No active projects found.");
      return;
    }

    const groups = [
      { title: "12WY Projects", items: projectEntries.filter((p) => p.is12WY) },
      { title: "Trips", items: projectEntries.filter((p) => !p.is12WY && p.isTravel) },
      { title: "Other Projects", items: projectEntries.filter((p) => !p.is12WY && !p.isTravel) },
    ];

    for (const group of groups) {
      if (!group.items.length) {
        continue;
      }
      const body = this.section(container, group.title, group.items.length);
      for (const project of group.items.sort((a, b) => a.fileName.localeCompare(b.fileName))) {
        const block = body.createDiv({ cls: "twelve-project" });
        const head = block.createDiv({ cls: "twelve-project-head" });
        this.projectPill(head, this.projectTitle(project.filePath), project.filePath, "twelve-project-name");
        head.createSpan({ cls: "twelve-badge twelve-badge-soft", text: `${project.tasks.length} open` });
        this.renderTaskTable(block, this.sortTasks(project.tasks), { showProject: false });
      }
    }
  }

  private getRecurringTasks(): Task[] {
    return this.taskIndex
      .getTasks()
      .filter((task) => task.every && task.status !== "done" && task.status !== "cancelled")
      .filter((task) => !this.isExcludedPath(task.filePath));
  }

  private async renderRecurring(container: HTMLElement) {
    const tasks = this.getRecurringTasks().sort(
      (a, b) =>
        (this.parseDateToken(a.due ?? "")?.getTime() ?? Infinity) -
        (this.parseDateToken(b.due ?? "")?.getTime() ?? Infinity)
    );
    const body = this.section(container, "Recurring", tasks.length || undefined);
    if (!tasks.length) {
      this.renderEmpty(body, "No recurring tasks found.");
      return;
    }
    this.renderTaskTable(body, tasks, { showDue: true, showProject: true });
  }

  // ---------------------------------------------------------------------------
  // 12WY cycle detail (pace table + this week's commitments + tracker)
  // ---------------------------------------------------------------------------

  private async render12WY(container: HTMLElement) {
    const cycle = await this.getCurrentCycle();
    if (!cycle) {
      this.renderEmpty(
        this.section(container, "12 Week Year"),
        `Unable to read ${this.resolvePath("12wy/current.md")} — it needs a "**Dates:** YYYY-MM-DD to YYYY-MM-DD" line.`
      );
      return;
    }

    const head = this.section(container, `12WY · Week ${cycle.weekNumber}`);
    head.createDiv({ cls: "twelve-faint", text: `Cycle: ${cycle.start} → ${cycle.end}` });

    this.render12WYTable(container, cycle.weekNumber);

    if (cycle.weekFile) {
      const weekContent = await this.app.vault.cachedRead(cycle.weekFile);
      const commitments = this.parseListSection(weekContent, "## Commitments");
      const tracker = this.parseTableSection(weekContent, "## Daily Tracker");
      this.renderCommitments(container, cycle.weekFile, cycle.weekNumber, commitments);
      this.renderTracker(container, cycle.weekFile, tracker);
    } else {
      this.renderEmpty(this.section(container, "This Week"), `Unable to locate ${cycle.weekPath}.`);
    }
  }

  private async toggleTaskDone(task: Task) {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    let lineIndex = this.findLineIndex(lines, task);
    if (lineIndex === -1) {
      new Notice("Unable to locate task line for toggle.");
      return;
    }

    const todayToken = this.formatDateToken(new Date());
    if (task.status === "done") {
      const updatedTask: Task = { ...task, status: "todo", done: undefined };
      lines[lineIndex] = serializeTask(updatedTask);
      await this.writeLinesToFile(file, lines);
    } else {
      const currentDoneTask: Task = { ...task, status: "done", done: todayToken };
      lines[lineIndex] = serializeTask(currentDoneTask);

      if (task.every) {
        const nextDue = this.computeNextRecurringDue(task.every, task.due || todayToken, new Date());
        if (nextDue) {
          const newTask: Task = {
            ...task,
            status: "todo",
            done: undefined,
            lineNumber: -1,
            lineText: "",
            due: nextDue,
            markers: task.markers.filter((marker) => marker !== "TODAY"),
          };
          const newLine = serializeTask(newTask);
          lines.splice(lineIndex + 1, 0, newLine);
        }
      }

      await this.writeLinesToFile(file, lines);
    }

    await this.taskIndex.updateFile(file);
    this.refreshPreview();
  }

  private async removeMarkerFromTask(task: Task, marker: string): Promise<Task | null> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      return null;
    }

    const updatedTask: Task = { ...task, markers: task.markers.filter((value) => value !== marker) };
    await this.replaceTaskLine(file, task, serializeTask(updatedTask));
    return updatedTask;
  }

  private async deferTask(task: Task, dueValue: string): Promise<Task | null> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      return null;
    }

    const updatedTask: Task = { ...task, due: dueValue, markers: task.markers.filter((marker) => marker !== "TODAY") };
    await this.replaceTaskLine(file, task, serializeTask(updatedTask));
    return updatedTask;
  }

  private async deleteTask(task: Task) {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      return;
    }

    // Deletion removes a line from the user's note and has no undo here, so
    // confirm first (mobile-safe modal rather than window.confirm).
    const confirmed = await this.confirm(
      "Delete task?",
      `This permanently removes the line from ${task.fileName}:\n\n${task.text}`
    );
    if (!confirmed) {
      return;
    }

    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const lineIndex = this.findLineIndex(lines, task);
    if (lineIndex === -1) {
      new Notice("Unable to locate task line for deletion.");
      return;
    }

    lines.splice(lineIndex, 1);
    await this.writeLinesToFile(file, lines);
    await this.taskIndex.updateFile(file);
  }

  private async editTaskText(task: Task) {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const newText = await this.promptText("Edit task text", task.text);
    if (newText === null) {
      return;
    }
    const trimmed = newText.trim();
    if (!trimmed || trimmed === task.text) {
      return;
    }

    const updatedTask: Task = { ...task, text: trimmed };
    await this.replaceTaskLine(file, task, serializeTask(updatedTask));
  }

  private promptText(title: string, initial: string): Promise<string | null> {
    return new Promise((resolve) => {
      new PromptModal(this.app, title, initial, resolve).open();
    });
  }

  private confirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      new ConfirmModal(this.app, title, message, resolve).open();
    });
  }

  private async replaceTaskLine(file: TFile, task: Task, serializedLine: string) {
    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const lineIndex = this.findLineIndex(lines, task);
    if (lineIndex === -1) {
      new Notice("Unable to locate task line for update.");
      return;
    }
    lines[lineIndex] = serializedLine;
    await this.writeLinesToFile(file, lines);
    await this.taskIndex.updateFile(file);
    this.refreshPreview();
  }

  private findLineIndex(lines: string[], task: Task): number {
    if (task.lineNumber >= 0 && task.lineNumber < lines.length) {
      if (lines[task.lineNumber] === task.lineText) {
        return task.lineNumber;
      }
    }

    const exactIndex = lines.findIndex((line) => line === task.lineText);
    if (exactIndex !== -1) {
      return exactIndex;
    }

    if (task.id) {
      const idIndex = lines.findIndex((line, index) => {
        const parsed = parseTaskLine(line, task.filePath, index, task.projectIs12WY);
        return parsed?.id === task.id;
      });
      if (idIndex !== -1) {
        return idIndex;
      }
    }

    const normalizedTaskText = this.normalizeLine(task.lineText);
    return lines.findIndex((line) => this.normalizeLine(line) === normalizedTaskText);
  }

  private normalizeLine(line: string): string {
    return line.trim().replace(/\s+/g, " ");
  }

  private async writeLinesToFile(file: TFile, lines: string[]) {
    await this.app.vault.modify(file, lines.join("\n"));
  }

  private async toggleListLine(file: TFile, item: CommitItem) {
    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    if (lines[item.lineNumber] !== item.lineText) {
      new Notice("Unable to locate commitment line.");
      return;
    }

    const updatedLine = lines[item.lineNumber].replace(/\[.\]/, item.status === "done" ? "[ ]" : "[x]");
    lines[item.lineNumber] = updatedLine;
    await this.writeLinesToFile(file, lines);
    await this.taskIndex.updateFile(file);
  }

  private async updateTrackerCell(file: TFile, lineIndex: number, cellIndex: number, value: string) {
    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const line = lines[lineIndex];
    if (!line) {
      new Notice("Unable to locate tracker row.");
      return;
    }

    // Operate on the same leading/trailing-trimmed cell model the renderer uses
    // so `cellIndex` lines up regardless of how the table row is padded.
    const cells = this.splitTableRow(line);
    if (cellIndex < 0 || cellIndex >= cells.length) {
      return;
    }

    cells[cellIndex] = value;
    lines[lineIndex] = `| ${cells.join(" | ")} |`;
    await this.writeLinesToFile(file, lines);
    await this.taskIndex.updateFile(file);
  }

  // Split a markdown table row into content cells, dropping only the single
  // empty segment produced by the leading and trailing pipe. Interior empty
  // cells are preserved — they're meaningful in the tracker (an unchecked day),
  // and dropping them would misalign data rows against the header.
  private splitTableRow(line: string): string[] {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length && cells[0] === "") {
      cells.shift();
    }
    if (cells.length && cells[cells.length - 1] === "") {
      cells.pop();
    }
    return cells;
  }

  private parseListSection(text: string, heading: string): CommitItem[] {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
    if (start === -1) {
      return [];
    }

    const items: CommitItem[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^##\s+/.test(line)) {
        break;
      }
      const match = /^\s*[-*]\s*\[([ xX/\-])\]\s*(.*)$/.exec(line);
      if (match) {
        const status = match[1].toLowerCase() === "x" ? "done" : "todo";
        items.push({ lineNumber: i, text: match[2], status, lineText: line });
      }
    }
    return items;
  }

  private parseTableSection(text: string, heading: string): {
    header: string[];
    rows: string[][];
    rowLines: number[];
    startLine: number;
  } {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
    if (start === -1) {
      return { header: [], rows: [], rowLines: [], startLine: -1 };
    }

    let header: string[] = [];
    const rows: string[][] = [];
    const rowLines: number[] = [];
    let currentLine = start + 1;
    while (currentLine < lines.length) {
      const rawLine = lines[currentLine];
      const line = rawLine.trim();
      if (!line) {
        currentLine++;
        continue;
      }
      if (/^##\s+/.test(line)) {
        break;
      }
      if (!header.length) {
        header = this.splitTableRow(rawLine);
      } else if (!/^\|?\s*-+/.test(line)) {
        rows.push(this.splitTableRow(rawLine));
        rowLines.push(currentLine);
      }
      currentLine++;
    }

    return { header, rows, rowLines, startLine: start };
  }

  private parseCurrentDates(text: string): { start: string; end: string } | null {
    const match = /\*\*Dates:\*\*\s*(\d{4}-\d{2}-\d{2})\s*to\s*(\d{4}-\d{2}-\d{2})/i.exec(text);
    if (!match) {
      return null;
    }
    return { start: match[1], end: match[2] };
  }

  private compute12WYWeek(startDate: Date, today: Date): number {
    const msPerDay = 1000 * 60 * 60 * 24;
    const dayIndex = Math.floor((today.getTime() - startDate.getTime()) / msPerDay);
    return Math.floor(dayIndex / 7) + 1;
  }

  private computeNextRecurringDue(interval: string, currentDue: string, reference: Date): string | undefined {
    const base = this.parseDateToken(currentDue) ?? this.normalizeDate(reference);
    const parsed = this.parseEveryInterval(interval);
    if (!parsed) {
      return undefined;
    }

    const next = this.addInterval(base, parsed);
    return this.formatDateToken(next);
  }

  private parseEveryInterval(value: string): { count: number; unit: "day" | "week" | "month" } | null {
    const normalized = value.trim().toLowerCase();
    const match = /^(\d+)?\s*(day|days|week|weeks|month|months)$/i.exec(normalized);
    if (!match) {
      return null;
    }
    const count = match[1] ? Number(match[1]) : 1;
    const unit = match[2].startsWith("day") ? "day" : match[2].startsWith("week") ? "week" : "month";
    return { count, unit };
  }

  private addInterval(date: Date, interval: { count: number; unit: "day" | "week" | "month" }): Date {
    const next = new Date(date.getTime());
    if (interval.unit === "day") {
      next.setDate(next.getDate() + interval.count);
    } else if (interval.unit === "week") {
      next.setDate(next.getDate() + interval.count * 7);
    } else {
      const day = next.getDate();
      next.setMonth(next.getMonth() + interval.count);
      if (next.getDate() !== day) {
        next.setDate(0);
      }
    }
    return this.normalizeDate(next);
  }

  private formatDateToken(value: Date): string {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  private getForecastGroup(task: Task, today: Date): string {
    const dueDate = this.parseDateToken(task.due ?? "");
    if (!dueDate) {
      return "Future Months";
    }

    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + (7 - today.getDay()));

    if (dueDate.getTime() <= weekEnd.getTime()) {
      return "This Week";
    }

    if (dueDate.getFullYear() === today.getFullYear() && dueDate.getMonth() === today.getMonth()) {
      return "Later This Month";
    }

    return "Future Months";
  }

  private isVisibleToday(task: Task, today: Date): boolean {
    if (task.status === "done" || task.status === "cancelled") {
      return false;
    }

    if (task.markers.some((marker) => marker.toUpperCase() === "WAITING")) {
      return false;
    }

    if (task.start && !this.isDateOnOrBefore(task.start, today)) {
      return false;
    }

    if (task.markers.some((marker) => marker.toUpperCase() === "TODAY")) {
      return true;
    }

    if (task.due && this.isDateOnOrBefore(task.due, today)) {
      return true;
    }

    return false;
  }

  private isDateOnOrBefore(dateToken: string, today: Date): boolean {
    const parsed = this.parseDateToken(dateToken);
    if (!parsed) {
      return false;
    }
    return parsed.getTime() <= this.normalizeDate(today).getTime();
  }

  private parseDateToken(token: string): Date | undefined {
    const normalized = token.trim();
    if (/^\d{4}-\d{2}$/.test(normalized)) {
      return new Date(`${normalized}-01T00:00:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return new Date(`${normalized}T00:00:00`);
    }
    if (normalized.toLowerCase() === "tomorrow") {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return this.normalizeDate(tomorrow);
    }
    // Tracker day labels like "M 06/01" or "06/01" — assume the current year so
    // the "days up to today" filter works on the daily tracker.
    const shortMatch = /^(?:[A-Za-z]{1,3}\s+)?(\d{1,2})\/(\d{1,2})$/.exec(normalized);
    if (shortMatch) {
      const year = new Date().getFullYear();
      const month = Number(shortMatch[1]);
      const day = Number(shortMatch[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return new Date(year, month - 1, day);
      }
    }
    return undefined;
  }

  private normalizeDate(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  // Compact, human-relative rendering of a due token, with a tone for coloring:
  // past = overdue, today, soon = within a week, future = further out.
  private relativeDate(token: string): { text: string; tone: "past" | "today" | "soon" | "future" } | null {
    const date = this.parseDateToken(token);
    if (!date) {
      return null;
    }
    const today = this.normalizeDate(new Date());
    const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);

    let text: string;
    if (diff === 0) {
      text = "today";
    } else if (diff === 1) {
      text = "tomorrow";
    } else if (diff === -1) {
      text = "yesterday";
    } else if (diff > 1 && diff <= 6) {
      text = date.toLocaleDateString(undefined, { weekday: "short" });
    } else if (diff < -1 && diff >= -6) {
      text = `${-diff}d ago`;
    } else {
      text = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }

    const tone = diff < 0 ? "past" : diff === 0 ? "today" : diff <= 6 ? "soon" : "future";
    return { text, tone };
  }

  private isIncludedPath(path: string): boolean {
    const normalizedRoot = this.getNormalizedRootFolder();
    const rootPrefix = normalizedRoot ? `${normalizedRoot}/` : "";
    if (normalizedRoot && !path.startsWith(rootPrefix)) {
      return false;
    }

    const prefixedPath = normalizedRoot ? path.substring(rootPrefix.length) : path;

    if (prefixedPath.startsWith("projects - archive/") || prefixedPath.startsWith("projects - new 12wy/")) {
      return false;
    }

    if (prefixedPath.startsWith(ACTIVE_PROJECT_FOLDER) || prefixedPath.startsWith(TWELVE_WY_FOLDER)) {
      return true;
    }

    if (this.settings.includeTicklerFolder && prefixedPath.startsWith(TICKLER_FOLDER)) {
      return true;
    }

    if (INCLUDED_FILE_NAMES.has(prefixedPath)) {
      if (prefixedPath === "recurring.md" && !this.settings.includeRecurringFile) {
        return false;
      }
      return true;
    }

    return false;
  }

  private isExcludedPath(path: string): boolean {
    return !this.isIncludedPath(path);
  }

  private resolvePath(path: string): string {
    const normalizedRoot = this.getNormalizedRootFolder();
    return normalizedRoot ? `${normalizedRoot}/${path}` : path;
  }

  private getNormalizedRootFolder(): string {
    return this.settings.rootFolder.trim().replace(/^\/+|\/+$/g, "");
  }

  private refreshPreviewNow() {
    const workspaceAny = this.app.workspace as any;
    if (typeof workspaceAny.requestMarkdownPreviewRefresh === "function") {
      workspaceAny.requestMarkdownPreviewRefresh();
    }
    if (typeof this.app.workspace.trigger === "function") {
      this.app.workspace.trigger("markdown:refresh");
    }

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = (leaf as any).view;
      if (view && typeof view.requestMarkdownPreviewRefresh === "function") {
        view.requestMarkdownPreviewRefresh();
      }
    }
  }
}

class TwelveSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TwelvePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "12 Plugin Settings" });

    // Saving rebuilds the whole index (re-reads matching files), so debounce
    // the root-folder text box rather than rebuilding on every keystroke.
    const saveRootFolder = debounce(() => this.plugin.saveSettings(), 500, true);

    new Setting(containerEl)
      .setName("GTD folder")
      .setDesc(
        'Folder holding your 12WY data and view notes (e.g. "gtd"). Start typing to pick a folder. Leave empty to use the whole vault.'
      )
      .addText((text) => {
        text
          .setPlaceholder("gtd")
          .setValue(this.plugin.settings.rootFolder)
          .onChange((value) => {
            this.plugin.settings.rootFolder = value;
            saveRootFolder();
          });
        const suggest = new FolderSuggest(this.app, text.inputEl);
        suggest.onSelect((folder) => {
          text.setValue(folder.path);
          this.plugin.settings.rootFolder = folder.path;
          saveRootFolder();
          suggest.close();
        });
      });

    new Setting(containerEl)
      .setName("Include tickler folder")
      .setDesc("Include tasks inside a tickler folder when rendering views.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeTicklerFolder)
          .onChange(async (value) => {
            this.plugin.settings.includeTicklerFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Include recurring file")
      .setDesc("Include the recurring file in task discovery and recurring task generation.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeRecurringFile)
          .onChange(async (value) => {
            this.plugin.settings.includeRecurringFile = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

class PromptModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private title: string,
    private initial: string,
    private onResult: (value: string | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });

    const input = contentEl.createEl("input", { type: "text" });
    input.value = this.initial;
    input.classList.add("twelve-prompt-input");
    input.focus();
    input.select();

    const submit = () => {
      if (this.settled) {
        return;
      }
      this.settled = true;
      const value = input.value;
      this.close();
      this.onResult(value);
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    });

    const buttons = contentEl.createDiv({ cls: "twelve-modal-buttons" });
    const save = buttons.createEl("button", { text: "Save" });
    save.classList.add("mod-cta");
    save.addEventListener("click", submit);
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.onResult(null);
    }
  }
}

class ConfirmModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private title: string,
    private message: string,
    private onResult: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    this.message.split("\n").forEach((line) => {
      contentEl.createEl("p", { text: line });
    });

    const settle = (confirmed: boolean) => {
      if (this.settled) {
        return;
      }
      this.settled = true;
      this.close();
      this.onResult(confirmed);
    };

    const buttons = contentEl.createDiv({ cls: "twelve-modal-buttons" });
    const confirm = buttons.createEl("button", { text: "Delete" });
    confirm.classList.add("mod-warning");
    confirm.addEventListener("click", () => settle(true));
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.classList.add("mod-cta");
    cancel.addEventListener("click", () => settle(false));
    cancel.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.onResult(false);
    }
  }
}

// Folder-name autocomplete for the GTD-folder setting.
class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(private appRef: App, inputEl: HTMLInputElement) {
    super(appRef, inputEl);
  }

  protected getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    return this.appRef.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .filter((folder) => folder.path.toLowerCase().includes(q))
      .slice(0, 50);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path === "/" ? "/ (vault root)" : folder.path);
  }
}
