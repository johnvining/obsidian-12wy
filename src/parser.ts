import { Task, TaskStatus, Priority } from "./types";

const TASK_LINE_RE = /^(\s*)([-*])\s*\[([ x\/-])\]\s*(.*)$/i;
const BRACKET_TOKEN_RE = /\[([^\]]+)\]$/;
const KNOWN_MARKERS = new Set(["TODAY", "ERRANDS", "WAITING", "URGENT", "SOON", "TRAVEL"]);
const PRIORITY_RE = /^p:(high|med|low)$/i;

export function parseTaskLine(line: string, filePath: string, lineNumber: number, projectIs12WY: boolean): Task | undefined {
  const match = TASK_LINE_RE.exec(line);
  if (!match) {
    return undefined;
  }

  const [, indent, bullet, statusMark, rest] = match;
  let text = rest.trim();
  const tokens: string[] = [];

  while (true) {
    const tokenMatch = BRACKET_TOKEN_RE.exec(text);
    if (!tokenMatch) {
      break;
    }
    // Don't consume Obsidian wikilinks (`[[Note]]`) that happen to sit at the
    // end of the line — the trailing `]]` would otherwise be parsed as a token
    // and corrupt the link on write-back.
    if (tokenMatch.index > 0 && text[tokenMatch.index - 1] === "[") {
      break;
    }
    const token = tokenMatch[0].trim();
    tokens.unshift(token);
    text = text.slice(0, tokenMatch.index).trim();
  }

  const markers: string[] = [];
  const extraTokens: string[] = [];
  const tags: string[] = [];
  let due: string | undefined;
  let start: string | undefined;
  let done: string | undefined;
  let every: string | undefined;
  let id: string | undefined;
  let priority: Priority | undefined;

  for (const token of tokens) {
    const content = token.slice(1, -1).trim();
    const normalized = content.toUpperCase();

    if (KNOWN_MARKERS.has(normalized)) {
      markers.push(normalized);
      continue;
    }

    if (/^DUE:/i.test(content)) {
      due = content.slice(4).trim();
      continue;
    }

    if (/^START:/i.test(content)) {
      start = content.slice(6).trim();
      continue;
    }

    if (/^DONE:/i.test(content)) {
      done = content.slice(5).trim();
      continue;
    }

    if (/^EVERY:/i.test(content)) {
      every = content.slice(6).trim();
      continue;
    }

    if (/^ID:/i.test(content)) {
      id = content.slice(3).trim();
      continue;
    }

    const priorityMatch = PRIORITY_RE.exec(content);
    if (priorityMatch) {
      priority = priorityMatch[1].toLowerCase() as Priority;
      continue;
    }

    if (content.startsWith("#")) {
      tags.push(content);
      continue;
    }

    extraTokens.push(content);
  }

  const status = parseStatus(statusMark);

  return {
    filePath,
    fileName: filePath.split("/").pop() || filePath,
    lineNumber,
    lineText: line,
    indent,
    bullet,
    status,
    text,
    markers,
    extraTokens,
    tags,
    due,
    start,
    done,
    every,
    id,
    priority,
    projectIs12WY,
  };
}

function parseStatus(mark: string): TaskStatus {
  switch (mark) {
    case "x":
    case "X":
      return "done";
    case "/":
      return "in-progress";
    case "-":
      return "cancelled";
    default:
      return "todo";
  }
}

export function serializeTask(task: Task): string {
  const statusMark = serializeStatus(task.status);
  const base = `${task.indent}${task.bullet} [${statusMark}] ${task.text}`.trimEnd();
  const tokens: string[] = [];

  const canonicalMarkers = ["TODAY", "ERRANDS", "WAITING", "URGENT", "SOON", "TRAVEL"];
  for (const marker of canonicalMarkers) {
    if (task.markers.includes(marker)) {
      tokens.push(`[${marker}]`);
    }
  }

  if (task.priority) {
    tokens.push(`[p:${task.priority}]`);
  }
  if (task.due) {
    tokens.push(`[due:${task.due}]`);
  }
  if (task.start) {
    tokens.push(`[start:${task.start}]`);
  }
  if (task.every) {
    tokens.push(`[every:${task.every}]`);
  }
  if (task.done) {
    tokens.push(`[done:${task.done}]`);
  }
  if (task.id) {
    tokens.push(`[id:${task.id}]`);
  }
  tokens.push(...task.extraTokens.map((token) => `[${token}]`));

  return tokens.length ? `${base} ${tokens.join(" ")}` : base;
}

function serializeStatus(status: TaskStatus): string {
  switch (status) {
    case "done":
      return "x";
    case "in-progress":
      return "/";
    case "cancelled":
      return "-";
    default:
      return " ";
  }
}

export function isTaskLine(line: string): boolean {
  return TASK_LINE_RE.test(line);
}
