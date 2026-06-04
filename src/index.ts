import { App, TFile } from "obsidian";
import { parseTaskLine } from "./parser";
import type { Task } from "./types";

const ACTIVE_PROJECT_FOLDER = "projects - active/";
const TWELVE_WY_FOLDER = "12wy/";
const TICKLER_FOLDER = "tickler/";
const INCLUDED_FILE_NAMES = new Set(["adhoc.md", "errands.md", "inbox.md", "recurring.md"]);
const EXCLUDED_PROJECT_PREFIXES = ["projects - archive/", "projects - new 12wy/"];

const STATUS_12WY_RE = /\*\*Status:\*\*.*\[12WY\]/i;
const STATUS_TRAVEL_RE = /\*\*Status:\*\*.*\[TRAVEL\]/i;
const PROGRESS_MARKER_RE = /\*\*12WY Progress:\*\*\s*(.*)$/i;
// A single progress metric: "<current> / <target> <label>" — label optional and
// may contain a parenthetical annotation, e.g. "59 / 100 poems posted" or
// "79 / 170 (inbox at 93 as of 2026-06-01)".
const METRIC_RE = /^(\d+)\s*\/\s*(\d+)\s*(.*)$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;

export type TaskIndexUpdateHandler = () => void;

export interface ProgressMetric {
  current: number;
  target: number;
  label: string;
}

export interface ProjectMeta {
  is12WY: boolean;
  isTravel: boolean;
  progress: ProgressMetric[];
}

export interface FileSnapshot {
  filePath: string;
  fileName: string;
  tasks: Task[];
  meta: ProjectMeta;
}

export class TaskIndex {
  private snapshots = new Map<string, FileSnapshot>();
  private listeners: TaskIndexUpdateHandler[] = [];

  constructor(
    private app: App,
    private rootFolder: string = "",
    private includeTicklerFolder: boolean = true,
    private includeRecurringFile: boolean = true
  ) {}

  async loadAll(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles().filter((file) => this.isIncludedPath(file.path));
    // Parse files independently so a single unreadable file can't reject the
    // entire index load.
    await Promise.all(files.map((file) => this.parseFile(file)));
    this.emitUpdate();
  }

  onUpdate(handler: TaskIndexUpdateHandler): void {
    this.listeners.push(handler);
  }

  getTasks(): Task[] {
    const tasks: Task[] = [];
    for (const snapshot of this.snapshots.values()) {
      tasks.push(...snapshot.tasks);
    }
    return tasks;
  }

  getSnapshots(): FileSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  getMeta(filePath: string): ProjectMeta | undefined {
    return this.snapshots.get(filePath)?.meta;
  }

  hasFile(file: TFile): boolean {
    return this.snapshots.has(file.path);
  }

  async updateFile(file: TFile): Promise<void> {
    if (!this.isMarkdown(file)) {
      return;
    }
    if (!this.isIncludedPath(file.path)) {
      if (this.snapshots.delete(file.path)) {
        this.emitUpdate();
      }
      return;
    }
    await this.parseFile(file);
    this.emitUpdate();
  }

  removeFile(path: string): void {
    if (this.snapshots.delete(path)) {
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

  private async parseFile(file: TFile): Promise<void> {
    let content: string;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch (error) {
      console.error(`[12] Failed to read ${file.path}`, error);
      return;
    }

    const rawLines = content.split(/\r?\n/);
    const meta = this.extractMeta(rawLines);
    const tasks: Task[] = [];

    rawLines.forEach((line, index) => {
      const task = parseTaskLine(line, file.path, index, meta.is12WY);
      if (task) {
        tasks.push(task);
      }
    });

    this.snapshots.set(file.path, {
      filePath: file.path,
      fileName: file.name,
      tasks,
      meta,
    });
  }

  private extractMeta(lines: string[]): ProjectMeta {
    const content = lines.join("\n");
    const is12WY = STATUS_12WY_RE.test(content);
    const isTravel = STATUS_TRAVEL_RE.test(content);
    const progress = this.extractProgress(lines);
    return { is12WY, isTravel, progress };
  }

  // Collect one or more progress metrics declared under a `**12WY Progress:**`
  // marker. A metric may sit inline on the marker line and/or as following
  // `- n / m label` bullets, so a project can track several measures at once.
  private extractProgress(lines: string[]): ProgressMetric[] {
    const metrics: ProgressMetric[] = [];

    for (let i = 0; i < lines.length; i++) {
      const markerMatch = PROGRESS_MARKER_RE.exec(lines[i]);
      if (!markerMatch) {
        continue;
      }

      const inline = this.parseMetric(markerMatch[1].trim());
      if (inline) {
        metrics.push(inline);
      }

      for (let j = i + 1; j < lines.length; j++) {
        const bulletMatch = BULLET_RE.exec(lines[j]);
        if (!bulletMatch) {
          break;
        }
        const metric = this.parseMetric(bulletMatch[1].trim());
        if (!metric) {
          break;
        }
        metrics.push(metric);
      }
    }

    return metrics;
  }

  private parseMetric(text: string): ProgressMetric | null {
    const match = METRIC_RE.exec(text);
    if (!match) {
      return null;
    }
    return {
      current: Number(match[1]),
      target: Number(match[2]),
      label: match[3].trim(),
    };
  }
}
