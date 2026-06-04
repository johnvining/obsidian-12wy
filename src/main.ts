import { App, MarkdownPostProcessorContext, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { TaskIndex } from "./index";
import { parseTaskLine, serializeTask } from "./parser";
import type { Task } from "./types";

interface TwelveSettings {
  rootFolder: string;
  includeTicklerFolder: boolean;
  includeRecurringFile: boolean;
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
  private settings: TwelveSettings = DEFAULT_SETTINGS;

  async onload() {
    console.log("Loading 12 plugin");
    await this.loadSettings();
    this.addSettingTab(new TwelveSettingTab(this.app, this));
    await this.initializeTaskIndex();
    this.taskIndex.onUpdate(() => this.refreshPreview());

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

  private async initializeTaskIndex() {
    this.taskIndex = new TaskIndex(
      this.app,
      this.settings.rootFolder,
      this.settings.includeTicklerFolder,
      this.settings.includeRecurringFile
    );
    await this.taskIndex.loadAll();
  }

  private async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  private async saveSettings() {
    await this.saveData(this.settings);
    await this.initializeTaskIndex();
    this.taskIndex.onUpdate(() => this.refreshPreview());
    this.refreshPreview();
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

    if (query === "errands") {
      await this.renderMarkerView(el, "ERRANDS", "Errands");
      return;
    }

    if (query === "waiting") {
      await this.renderMarkerView(el, "WAITING", "Waiting");
      return;
    }

    if (query === "projects") {
      await this.renderProjects(el);
      return;
    }

    if (query === "12wy") {
      await this.render12WY(el);
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
      group.tasks.forEach((task) => groupEl.appendChild(this.renderTaskRow(task, true)));
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

  private async renderMarkerView(container: HTMLElement, marker: string, title: string) {
    const tasks = this.taskIndex
      .getTasks()
      .filter((task) => task.markers.includes(marker))
      .filter((task) => !this.isExcludedPath(task.filePath));

    if (!tasks.length) {
      container.createEl("div", { text: `No ${title.toLowerCase()} tasks found.` });
      return;
    }

    const groupEl = container.createEl("div", { cls: "twelve-group" });
    groupEl.createEl("h3", { text: title });
    tasks.forEach((task) => groupEl.appendChild(this.renderTaskRow(task)));
  }

  private async renderProjects(container: HTMLElement) {
    const projectMap = new Map<string, { fileName: string; is12WY: boolean; isTravel: boolean; tasks: Task[] }>();

    for (const task of this.taskIndex.getTasks()) {
      if (task.status === "done" || task.status === "cancelled") {
        continue;
      }
      if (this.isExcludedPath(task.filePath)) {
        continue;
      }

      const project = projectMap.get(task.filePath);
      if (project) {
        project.tasks.push(task);
        continue;
      }

      projectMap.set(task.filePath, {
        fileName: task.fileName,
        is12WY: task.projectIs12WY,
        isTravel: false,
        tasks: [task],
      });
    }

    if (!projectMap.size) {
      container.createEl("div", { text: "No active projects found." });
      return;
    }

    const projectEntries = await Promise.all(
      Array.from(projectMap.entries()).map(async ([filePath, project]) => {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        let isTravel = false;

        if (file instanceof TFile) {
          const content = await this.app.vault.read(file);
          isTravel = /\*\*Status:\*\*.*\[TRAVEL\]/i.test(content);
        }

        return {
          filePath,
          fileName: project.fileName,
          is12WY: project.is12WY,
          isTravel,
          tasks: project.tasks,
        };
      })
    );

    const groups = [
      { title: "12WY Projects", items: projectEntries.filter((p) => p.is12WY) },
      { title: "Trips", items: projectEntries.filter((p) => !p.is12WY && p.isTravel) },
      { title: "Other Projects", items: projectEntries.filter((p) => !p.is12WY && !p.isTravel) },
    ];

    for (const group of groups) {
      if (!group.items.length) {
        continue;
      }

      const groupEl = container.createEl("div", { cls: "twelve-group" });
      groupEl.createEl("h3", { text: group.title });

      for (const project of group.items.sort((a, b) => a.fileName.localeCompare(b.fileName))) {
        const projectEl = groupEl.createEl("div", { cls: "twelve-project" });
        projectEl.createEl("strong", { text: `${project.fileName} (${project.tasks.length} open)` });

        project.tasks.forEach((task) => projectEl.appendChild(this.renderTaskRow(task)));
      }
    }
  }

  private async render12WY(container: HTMLElement) {
    const currentFile = this.app.vault.getAbstractFileByPath(this.resolvePath("12wy/current.md"));
    if (!(currentFile instanceof TFile)) {
      container.createEl("div", { text: `Unable to locate ${this.resolvePath("12wy/current.md")}.` });
      return;
    }

    const currentContent = await this.app.vault.read(currentFile);
    const currentDates = this.parseCurrentDates(currentContent);
    if (!currentDates) {
      container.createEl("div", { text: "Unable to parse current 12WY cycle dates." });
      return;
    }

    const today = this.normalizeDate(new Date());
    const startDate = this.parseDateToken(currentDates.start);
    if (!startDate) {
      container.createEl("div", { text: "Unable to parse 12WY start date." });
      return;
    }

    const currentWeek = this.compute12WYWeek(startDate, today);
    const weekNumber = Math.min(Math.max(currentWeek, 1), 13);
    const weekFilePath = this.resolvePath(`12wy/weeks/w${weekNumber.toString().padStart(2, "0")}.md`);
    const weekFile = this.app.vault.getAbstractFileByPath(weekFilePath);

    const paceItems = await this.collect12WYPace(weekNumber);

    const summaryEl = container.createEl("div", { cls: "twelve-group" });
    summaryEl.createEl("h3", { text: `12WY Week ${weekNumber}` });
    summaryEl.createEl("div", { text: `Cycle: ${currentDates.start} → ${currentDates.end}` });
    const executionEl = summaryEl.createEl("div", { text: "Execution: calculating..." });

    const paceGroup = container.createEl("div", { cls: "twelve-group" });
    paceGroup.createEl("h4", { text: "Project pace" });
    if (!paceItems.paceRows.length) {
      paceGroup.createEl("div", { text: "No 12WY project progress lines found." });
    } else {
      paceItems.paceRows.forEach((row) => {
        const rowEl = paceGroup.createEl("div", { cls: `twelve-pace-row twelve-pace-${row.status}` });
        rowEl.textContent = `${row.fileName}: ${row.current}/${row.target} (expected ${row.expected})`;
      });
    }

    if (!(weekFile instanceof TFile)) {
      container.createEl("div", { text: `Unable to locate ${weekFilePath}.` });
      return;
    }

    const weekContent = await this.app.vault.read(weekFile);
    const commitBlock = this.parseListSection(weekContent, "## Commitments");
    const trackerBlock = this.parseTableSection(weekContent, "## Daily Tracker");
    const commitmentsDone = commitBlock.filter((item) => item.status === "done").length;
    const commitmentsTotal = commitBlock.length;
    const executionPercent = commitmentsTotal ? (commitmentsDone / commitmentsTotal) * 100 : 0;
    executionEl.textContent = `Execution: ${executionPercent.toFixed(0)}% (${commitmentsDone}/${commitmentsTotal})`;

    const commitGroup = container.createEl("div", { cls: "twelve-group" });
    commitGroup.createEl("h4", { text: "Commitments" });
    if (!commitBlock.length) {
      commitGroup.createEl("div", { text: "No commitments section found." });
    } else {
      commitBlock.forEach((item) => {
        const taskRow = document.createElement("div");
        taskRow.className = "twelve-task-row";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.status === "done";
        checkbox.addEventListener("change", async () => {
          await this.toggleListLine(weekFile, item);
        });
        taskRow.appendChild(checkbox);

        const textEl = document.createElement("span");
        textEl.className = "twelve-task-text";
        textEl.textContent = item.text;
        taskRow.appendChild(textEl);

        commitGroup.appendChild(taskRow);
      });
    }

    const trackerGroup = container.createEl("div", { cls: "twelve-group" });
    trackerGroup.createEl("h4", { text: "Daily Tracker" });
    if (!trackerBlock.header.length || !trackerBlock.rows.length) {
      trackerGroup.createEl("div", { text: "Unable to parse daily tracker table." });
    } else {
      const tableEl = document.createElement("div");
      tableEl.className = "twelve-grid";
      const headerRow = document.createElement("div");
      headerRow.className = "twelve-grid-row twelve-grid-header";
      trackerBlock.header.forEach((column) => {
        const headerCell = document.createElement("div");
        headerCell.className = "twelve-grid-cell";
        headerCell.textContent = column;
        headerRow.appendChild(headerCell);
      });
      tableEl.appendChild(headerRow);

      trackerBlock.rows.forEach((row, rowIndex) => {
        const lineDate = this.parseDateToken(row[0]) || today;
        if (lineDate.getTime() > today.getTime()) {
          return;
        }

        const rowEl = document.createElement("div");
        rowEl.className = "twelve-grid-row";

        row.forEach((cell, cellIndex) => {
          const cellEl = document.createElement("div");
          cellEl.className = "twelve-grid-cell";
          cellEl.textContent = cell || " ";
          if (cellIndex > 0) {
            cellEl.classList.add("twelve-grid-clickable");
            cellEl.addEventListener("click", async () => {
              const lineIndex = trackerBlock.rowLines[rowIndex];
              if (lineIndex !== undefined) {
                await this.updateTrackerCell(weekFile, lineIndex, cellIndex, "Y");
              }
            });
          }
          rowEl.appendChild(cellEl);
        });

        tableEl.appendChild(rowEl);
      });

      trackerGroup.appendChild(tableEl);
    }
  }

  private renderTaskRow(task: Task, includeActions = false): HTMLElement {
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
    const metaParts = [task.fileName, task.due ? `due:${task.due}` : undefined].filter(Boolean);
    metaEl.textContent = ` ${metaParts.join(" · ")}`;
    row.appendChild(metaEl);

    if (includeActions) {
      const actionsEl = document.createElement("span");
      actionsEl.className = "twelve-task-actions";
      actionsEl.appendChild(this.createActionButton("Remove TODAY", async () => {
        const updatedTask = await this.removeMarkerFromTask(task, "TODAY");
        if (updatedTask && !this.isVisibleToday(updatedTask, new Date())) {
          row.remove();
        }
      }));
      actionsEl.appendChild(this.createActionButton("Tomorrow", async () => {
        const updatedTask = await this.deferTask(task, "tomorrow");
        if (updatedTask && !this.isVisibleToday(updatedTask, new Date())) {
          row.remove();
        }
      }));
      actionsEl.appendChild(this.createActionButton("Delete", async () => await this.deleteTask(task)));
      actionsEl.appendChild(this.createActionButton("Edit", async () => await this.editTaskText(task)));
      row.appendChild(actionsEl);
    }

    return row;
  }

  private createActionButton(label: string, onClick: () => Promise<void>): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "twelve-action-button";
    button.textContent = label;
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await onClick();
    });
    return button;
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
    this.refreshPreview();
  }

  private async editTaskText(task: Task) {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const newText = window.prompt("Edit task text:", task.text);
    if (newText === null || newText.trim() === task.text) {
      return;
    }

    const updatedTask: Task = { ...task, text: newText.trim() };
    await this.replaceTaskLine(file, task, serializeTask(updatedTask));
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

  private async toggleListLine(file: TFile, item: { lineNumber: number; text: string; status: string }) {
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
    this.refreshPreview();
  }

  private async updateTrackerCell(file: TFile, lineIndex: number, cellIndex: number, value: string) {
    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const line = lines[lineIndex];
    if (!line) {
      return;
    }

    const cells = line.split("|").map((cell) => cell.trim());
    if (cellIndex >= cells.length) {
      return;
    }

    cells[cellIndex] = value;
    lines[lineIndex] = `| ${cells.slice(1, -1).join(" | ")} |`;
    await this.writeLinesToFile(file, lines);
    this.refreshPreview();
  }

  private parseListSection(text: string, heading: string): Array<{ lineNumber: number; text: string; status: string }> {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
    if (start === -1) {
      return [];
    }

    const items: Array<{ lineNumber: number; text: string; status: string }> = [];
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

  private parseTableSection(text: string, heading: string) {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
    if (start === -1) {
      return { header: [] as string[], rows: [] as string[][], startLine: -1 };
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
        header = rawLine.split("|").map((cell) => cell.trim()).filter((cell) => cell.length > 0);
      } else if (!/^\|?\s*-+/.test(line)) {
        const cells = rawLine.split("|").map((cell) => cell.trim());
        rows.push(cells);
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

  private async collect12WYPace(weekNumber: number) {
    const files = this.app.vault.getMarkdownFiles();
    const paceRows: Array<{ fileName: string; current: number; target: number; expected: number; status: string }> = [];
    let commitmentsDone = 0;
    let commitmentsTotal = 0;

    for (const file of files) {
      if (this.isExcludedPath(file.path)) {
        continue;
      }
      const content = await this.app.vault.read(file);
      if (/\*\*Status:\*\*.*\[12WY\]/i.test(content)) {
        const match = /\*\*12WY Progress:\*\*\s*(\d+)\s*\/\s*(\d+)/i.exec(content);
        if (match) {
          const current = Number(match[1]);
          const target = Number(match[2]);
          const expected = Math.max(1, Math.round((weekNumber / 12) * target));
          const ratio = target > 0 ? current / expected : 1;
          const status = ratio >= 1 ? "good" : ratio >= 0.75 ? "warning" : "danger";
          paceRows.push({ fileName: file.name, current, target, expected, status });
        }
      }

      const commitMatches = content.matchAll(/[-*]\s*\[(x| )\]\s.*$/gim);
      for (const match of commitMatches) {
        commitmentsTotal += 1;
        if (match[1].toLowerCase() === "x") {
          commitmentsDone += 1;
        }
      }
    }

    const executionPercent = commitmentsTotal ? (commitmentsDone / commitmentsTotal) * 100 : 0;
    return { paceRows, commitmentsDone, commitmentsTotal, executionPercent };
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

  private refreshPreview() {
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

    new Setting(containerEl)
      .setName("Root folder")
      .setDesc("Limit task discovery to a vault subfolder. Leave empty to use the vault root.")
      .addText((text) =>
        text
          .setPlaceholder("projects - active")
          .setValue(this.plugin.settings.rootFolder)
          .onChange(async (value) => {
            this.plugin.settings.rootFolder = value;
            await this.plugin.saveSettings();
          })
      );

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
