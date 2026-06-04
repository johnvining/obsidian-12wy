import { App, MetadataCache, TFile, Vault } from "obsidian";
import { parseTaskLine, serializeTask } from "./parser";
import type { Task } from "./types";

const ACTIVE_PROJECT_FOLDER = "projects - active/";
const TWELVE_WY_FOLDER = "12wy/";
const TICKLER_FOLDER = "tickler/";
const INCLUDED_FILE_NAMES = new Set(["adhoc.md", "errands.md", "inbox.md", "recurring.md"]);
const EXCLUDED_PROJECT_PREFIXES = ["projects - archive/", "projects - new 12wy/"];

export type TaskIndexUpdateHandler = () => void;

export class TaskIndex {
  private taskMap = new Map<string, Task[]>();
  private listeners: TaskIndexUpdateHandler[] = [];

  constructor(
    private app: App,
    private rootFolder: string = "",
    private includeTicklerFolder: boolean = true,
    private includeRecurringFile: boolean = true
  ) {}

  async loadAll(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles().filter((file) => this.isIncludedPath(file.path));
    await Promise.all(files.map((file) => this.parseFile(file)));
    this.emitUpdate();
  }

  onUpdate(handler: TaskIndexUpdateHandler): void {
    this.listeners.push(handler);
  }

  getTasks(): Task[] {
    return Array.from(this.taskMap.values()).flat();
  }

  hasFile(file: TFile): boolean {
    return this.taskMap.has(file.path);
  }

  async updateFile(file: TFile): Promise<void> {
    if (!this.isMarkdown(file)) {
      return;
    }
    if (!this.isIncludedPath(file.path)) {
      this.taskMap.delete(file.path);
      this.emitUpdate();
      return;
    }
    await this.parseFile(file);
    this.emitUpdate();
  }

  removeFile(path: string): void {
    if (this.taskMap.delete(path)) {
      this.emitUpdate();
    }
  }

  async refreshFile(file: TFile): Promise<void> {
    await this.updateFile(file);
  }

  private emitUpdate(): void {
    this.listeners.forEach((listener) => listener());
  }

  private isMarkdown(file: TFile): boolean {
    return file.extension === "md";
  }

  private isIncludedPath(path: string): boolean {
    const normalizedRoot = this.rootFolder.trim().replace(/^\/+|\/+$/g, "");
    const rootPrefix = normalizedRoot ? `${normalizedRoot}/` : "";
    if (normalizedRoot && !path.startsWith(rootPrefix)) {
      return false;
    }

    const prefixedPath = normalizedRoot ? path.substring(rootPrefix.length) : path;

    if (EXCLUDED_PROJECT_PREFIXES.some((prefix) => prefixedPath.startsWith(prefix))) {
      return false;
    }

    if (prefixedPath.startsWith(ACTIVE_PROJECT_FOLDER) || prefixedPath.startsWith(TWELVE_WY_FOLDER)) {
      return true;
    }

    if (this.includeTicklerFolder && prefixedPath.startsWith(TICKLER_FOLDER)) {
      return true;
    }

    if (INCLUDED_FILE_NAMES.has(prefixedPath)) {
      if (prefixedPath === "recurring.md" && !this.includeRecurringFile) {
        return false;
      }
      return true;
    }

    return false;
  }

  private isExcludedPath(path: string): boolean {
    if (!this.isIncludedPath(path)) {
      return true;
    }
    return EXCLUDED_PROJECT_PREFIXES.some((prefix) => path.startsWith(prefix));
  }

  private async parseFile(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const rawLines = content.split(/\r?\n/);
    const projectIs12WY = rawLines.some((line) => /\*\*Status:\*\*.*\[12WY\]/i.test(line));
    const tasks: Task[] = [];

    rawLines.forEach((line, index) => {
      const task = parseTaskLine(line, file.path, index, projectIs12WY);
      if (task) {
        tasks.push(task);
      }
    });

    this.taskMap.set(file.path, tasks);
  }
}
