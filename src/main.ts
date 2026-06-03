import { App, MarkdownPostProcessorContext, Notice, Plugin, TFile } from "obsidian";
import { TaskIndex } from "./index";
import { serializeTask } from "./parser";
import type { Task } from "./types";

const EXCLUDED_PROJECT_PREFIXES = ["projects - archive/", "projects - new 12wy/"];

export default class TwelvePlugin extends Plugin {
  private taskIndex!: TaskIndex;

  async onload() {
    console.log("Loading 12 plugin");
    this.taskIndex = new TaskIndex(this.app);

    await this.taskIndex.loadAll();

    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile && file.extension === "md") {
          await this.taskIndex.updateFile(file);
          this.refreshPreview();
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          this.taskIndex.removeFile(oldPath);
          await this.taskIndex.updateFile(file);
          this.refreshPreview();
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.taskIndex.removeFile(file.path);
          this.refreshPreview();
        }
      })
    );

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.taskIndex.refreshFile(file);
          this.refreshPreview();
        }
      })
    );

    this.taskIndex.onUpdate(() => this.refreshPreview());

    this.registerMarkdownCodeBlockProcessor("12", async (source, el, ctx) => {
      await this.processCodeBlock(source, el, ctx);
    });
  }

  onunload() {
    console.log("Unloading 12 plugin");
  }

  private async processCodeBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    el.empty();
    const query = source.trim().split(/\s+/)[0]?.toLowerCase();
    if (!query || query === "today") {
      await this.renderToday(el);
      return;
    }

    if (query === "forecast") {
      await this.renderForecast(el);
      return;
    }

    el.createEl("div", { text: `Unknown 12 query: ${query}` });
  }

  private async renderToday(container: HTMLElement) {
    const today = new Date();
    const tasks = this.taskIndex
      .getTasks()
      .filter((task) => this.isVisibleToday(task, today))
      .filter((task) => !this.isExcludedPath(task.filePath));

    const grouped = this.groupTasks(tasks);

    if (!tasks.length) {
      container.createEl("div", { text: "No tasks for today." });
      return;
    }

    for (const group of grouped) {
      const groupEl = container.createEl("div", { cls: "twelve-group" });
      groupEl.createEl("h3", { text: group.title });
      group.tasks.forEach((task) => groupEl.appendChild(this.renderTaskRow(task)));
    }
  }

  private async renderForecast(container: HTMLElement) {
    const today = this.normalizeDate(new Date());
    const tasks = this.taskIndex
      .getTasks()
      .filter((task) => task.due && task.status !== "done" && task.status !== "cancelled")
      .filter((task) => !this.isExcludedPath(task.filePath))
      .sort((a, b) => {
        const aDate = this.parseDateToken(a.due!);
        const bDate = this.parseDateToken(b.due!);
        return (aDate?.getTime() ?? Infinity) - (bDate?.getTime() ?? Infinity);
      });

    if (!tasks.length) {
      container.createEl("div", { text: "No upcoming tasks found." });
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
      const groupEl = container.createEl("div", { cls: "twelve-group" });
      groupEl.createEl("h3", { text: title });
      groupTasks.forEach((task) => groupEl.appendChild(this.renderForecastRow(task)));
    }
  }

  private renderForecastRow(task: Task): HTMLElement {
    const row = document.createElement("div");
    row.className = "twelve-task-row";

    const textEl = document.createElement("span");
    textEl.className = "twelve-task-text";
    textEl.textContent = task.text;
    row.appendChild(textEl);

    const dueEl = document.createElement("span");
    dueEl.className = "twelve-task-meta";
    dueEl.textContent = task.due ?? "no due date";
    row.appendChild(dueEl);

    const projectEl = document.createElement("span");
    projectEl.className = "twelve-task-meta";
    projectEl.textContent = ` ${task.fileName}`;
    row.appendChild(projectEl);

    return row;
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

  private renderTaskRow(task: Task): HTMLElement {
    const row = document.createElement("div");
    row.className = "twelve-task-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.status === "done";
    checkbox.addEventListener("change", async () => {
      await this.toggleTaskDone(task);
    });
    row.appendChild(checkbox);

    const textEl = document.createElement("span");
    textEl.className = "twelve-task-text";
    textEl.textContent = `${task.text} ${task.markers.map((m) => `[${m}]`).join(" ")}`.trim();
    row.appendChild(textEl);

    const metaEl = document.createElement("span");
    metaEl.className = "twelve-task-meta";
    metaEl.textContent = ` ${task.fileName}`;
    row.appendChild(metaEl);

    return row;
  }

  private async toggleTaskDone(task: Task) {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    let lineIndex = task.lineNumber;
    if (lines[lineIndex] !== task.lineText) {
      const found = lines.findIndex((line) => line === task.lineText);
      if (found === -1) {
        new Notice("Unable to locate task line for toggle.");
        return;
      }
      lineIndex = found;
    }

    const updatedTask: Task = { ...task, status: task.status === "done" ? "todo" : "done" };
    const serialized = serializeTask(updatedTask);
    lines[lineIndex] = serialized;

    await this.app.vault.modify(file, lines.join("\n"));
    await this.taskIndex.updateFile(file);
    this.refreshPreview();
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
    const monthMatch = /^\d{4}-\d{2}$/; 
    if (monthMatch.test(normalized)) {
      return new Date(`${normalized}-01T00:00:00`);
    }
    const dayMatch = /^\d{4}-\d{2}-\d{2}$/;
    if (dayMatch.test(normalized)) {
      return new Date(`${normalized}T00:00:00`);
    }
    if (normalized.toLowerCase() === "tomorrow") {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return this.normalizeDate(tomorrow);
    }
    return undefined;
  }

  private normalizeDate(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  private groupTasks(tasks: Task[]) {
    const groups: { title: string; tasks: Task[] }[] = [];
    const twelveWY = tasks.filter((task) => task.projectIs12WY);
    const waiting = tasks.filter((task) => task.markers.includes("WAITING") && !task.projectIs12WY);
    const others = tasks.filter((task) => !task.projectIs12WY && !task.markers.includes("WAITING"));

    if (twelveWY.length) {
      groups.push({ title: "12WY Projects", tasks: twelveWY });
    }
    if (others.length) {
      groups.push({ title: "Other Projects", tasks: others });
    }
    if (waiting.length) {
      groups.push({ title: "Waiting", tasks: waiting });
    }
    return groups;
  }

  private isExcludedPath(path: string): boolean {
    return EXCLUDED_PROJECT_PREFIXES.some((prefix) => path.startsWith(prefix));
  }

  private refreshPreview() {
    const workspaceAny = this.app.workspace as any;
    if (typeof workspaceAny.requestMarkdownPreviewRefresh === "function") {
      workspaceAny.requestMarkdownPreviewRefresh();
      return;
    }
    if (typeof this.app.workspace.trigger === "function") {
      this.app.workspace.trigger("markdown:refresh");
    }
  }
}
