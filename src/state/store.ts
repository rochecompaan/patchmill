import fs from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import fsExt from "fs-ext";
import type { Issue } from "../host/types.ts";

export const STATE_DIR = ".patchmill/state";
export type WorkflowStatus =
  | "ready"
  | "inProgress"
  | "needsInfo"
  | "done"
  | "unsuitable";
export type StatusChange = {
  at: string;
  status: WorkflowStatus;
  runId?: string;
  summary?: string;
  cost?: string;
  warnings?: string[];
  questionUrl?: string;
};
export type SyncCursor = {
  repository: string;
  fullSyncAt: string;
  syncedUpTo: string;
};

// Shared across instances so only one blocking flock per path reaches libuv.
const appends = new Map<string, Promise<void>>();

export class StateStore {
  private readonly root: string;
  private readonly warn: (message: string) => void;

  constructor(root: string, warn: (message: string) => void = () => {}) {
    this.root = root;
    this.warn = warn;
  }

  readCursor(): Promise<SyncCursor | undefined> {
    return this.readJson(join(this.root, "sync.json"));
  }

  writeCursor(cursor: SyncCursor): Promise<void> {
    return this.writeJson(join(this.root, "sync.json"), cursor);
  }

  readIssue(n: number): Promise<Issue | undefined> {
    return this.readJson(join(this.root, `${n}.json`));
  }

  writeIssue(issue: Issue): Promise<void> {
    return this.writeJson(join(this.root, `${issue.number}.json`), issue);
  }

  async listIssues(): Promise<{ issues: Issue[]; damaged: number[] }> {
    let names: string[];
    try {
      names = await fs.readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { issues: [], damaged: [] };
      }
      throw error;
    }
    const issues: Issue[] = [];
    const damaged: number[] = [];
    for (const name of names) {
      if (!/^\d+\.json$/.test(name)) continue;
      const n = Number(name.slice(0, -5));
      const issue = await this.readJson<Issue>(join(this.root, name));
      if (issue === undefined) damaged.push(n);
      else issues.push(issue);
    }
    issues.sort((a, b) => a.number - b.number);
    damaged.sort((a, b) => a - b);
    return { issues, damaged };
  }

  async removeIssue(n: number): Promise<void> {
    await fs.rm(join(this.root, `${n}.json`), { force: true });
  }

  async readStatus(n: number): Promise<StatusChange[]> {
    const path = join(this.root, "status", `${n}.jsonl`);
    let text: string;
    try {
      text = await fs.readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const lines = text.split("\n");
    const tail = lines.pop();
    if (tail) this.warn(`Ignoring unfinished status record in ${path}`);
    return lines.map((line, index) => {
      try {
        return JSON.parse(line) as StatusChange;
      } catch (error) {
        throw new Error(
          `Invalid status record in ${path} at line ${index + 1}`,
          {
            cause: error,
          },
        );
      }
    });
  }

  appendStatus(n: number, change: StatusChange): Promise<void> {
    const path = join(this.root, "status", `${n}.jsonl`);
    const previous = appends.get(path) ?? Promise.resolve();
    const result = previous.then(() => this.appendLocked(path, change));
    // Rejections reach the caller, but must not poison subsequent appends.
    const settled = result.then(
      () => {},
      () => {},
    );
    appends.set(path, settled);
    void settled.then(() => {
      if (appends.get(path) === settled) appends.delete(path);
    });
    return result;
  }

  private async appendLocked(
    path: string,
    change: StatusChange,
  ): Promise<void> {
    await fs.mkdir(join(this.root, "status"), { recursive: true });
    const handle = await fs.open(path, constants.O_CREAT | constants.O_RDWR);
    try {
      await new Promise<void>((resolve, reject) => {
        fsExt.flock(handle.fd, "ex", (error) =>
          error ? reject(error) : resolve(),
        );
      });
      const bytes = await handle.readFile();
      let end = bytes.length;
      if (end > 0 && bytes[end - 1] !== 10) {
        end = bytes.lastIndexOf(10) + 1;
        await handle.truncate(end);
        this.warn(`Discarding unfinished status record in ${path}`);
      }
      const record = Buffer.from(JSON.stringify(change) + "\n");
      const { bytesWritten } = await handle.write(
        record,
        0,
        record.length,
        end,
      );
      if (bytesWritten !== record.length) {
        throw new Error(`Incomplete status write to ${path}`);
      }
    } finally {
      await handle.close();
    }
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    try {
      return JSON.parse(await fs.readFile(path, "utf8")) as T;
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeJson(
    path: string,
    value: Issue | SyncCursor,
  ): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value));
    await fs.rename(temporary, path);
  }
}
