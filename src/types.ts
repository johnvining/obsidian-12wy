export type TaskStatus = "todo" | "done" | "in-progress" | "cancelled";
export type Priority = "high" | "med" | "low";

export interface Task {
  filePath: string;
  fileName: string;
  lineNumber: number;
  lineText: string;
  indent: string;
  bullet: string;
  status: TaskStatus;
  text: string;
  markers: string[];
  extraTokens: string[];
  tags: string[];
  start?: string;
  done?: string;
  every?: string;
  id?: string;
  priority?: Priority;
  projectIs12WY: boolean;
}

export interface TaskFileSnapshot {
  filePath: string;
  fileName: string;
  tasks: Task[];
  rawLines: string[];
  projectIs12WY: boolean;
}
