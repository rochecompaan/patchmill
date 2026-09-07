import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  assertPlanningIssueLockOwned,
  type PlanningIssueLock,
} from "./planning-issue-lock.ts";
import {
  PlanningStateValidationError,
  assertPlanningStateReplacement,
  parsePlanningState,
  serializePlanningState,
  validatePlanningState,
  type PlanningStateV1,
} from "./planning-state.ts";
export type PlanningStateConflictReason =
  | "state-exists"
  | "state-missing"
  | "run-id-mismatch"
  | "revision-mismatch"
  | "lock-path-mismatch"
  | "lock-ownership-mismatch";
export class PlanningStateConflictError extends Error {
  readonly reason: PlanningStateConflictReason;
  readonly statePath: string;
  constructor(reason: PlanningStateConflictReason, statePath: string) {
    super(`Planning state conflict: ${reason}`);
    this.name = "PlanningStateConflictError";
    this.reason = reason;
    this.statePath = statePath;
  }
}
export function planningStatePath(
  runStateDir: string,
  issueNumber: number,
): string {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1)
    throw new RangeError("Issue number must be positive");
  return join(
    resolve(runStateDir),
    "planning-pr-v1",
    "issues",
    `issue-${issueNumber}.json`,
  );
}
export class PlanningStateStore {
  readonly runStateDir: string;
  readonly beforeRename:
    | ((temporary: string, target: string) => Promise<void>)
    | undefined;
  constructor(
    runStateDir: string,
    options: {
      beforeRename?: (temporary: string, target: string) => Promise<void>;
    } = {},
  ) {
    this.runStateDir = resolve(runStateDir);
    this.beforeRename = options.beforeRename;
  }
  path(issueNumber: number): string {
    return planningStatePath(this.runStateDir, issueNumber);
  }
  async read(issueNumber: number): Promise<PlanningStateV1 | undefined> {
    const path = this.path(issueNumber);
    try {
      return parsePlanningState(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      if (error instanceof PlanningStateValidationError)
        throw new PlanningStateValidationError(error.reason, error.path, path);
      throw error;
    }
  }
  async initialize(input: {
    state: PlanningStateV1;
    lock: PlanningIssueLock;
  }): Promise<PlanningStateV1> {
    const state = validatePlanningState(input.state);
    const path = this.path(state.issueNumber);
    await mkdir(dirname(path), { recursive: true });
    if ((await this.read(state.issueNumber)) !== undefined)
      throw new PlanningStateConflictError("state-exists", path);
    await this.owned(input.lock, state.issueNumber, state.runId, path);
    await this.write(path, state, false);
    return state;
  }
  async replace(input: {
    issueNumber: number;
    expectedRunId: string;
    expectedRevision: number;
    next: PlanningStateV1;
    lock: PlanningIssueLock;
  }): Promise<PlanningStateV1> {
    const path = this.path(input.issueNumber);
    const current = await this.read(input.issueNumber);
    if (current === undefined)
      throw new PlanningStateConflictError("state-missing", path);
    if (current.runId !== input.expectedRunId)
      throw new PlanningStateConflictError("run-id-mismatch", path);
    if (current.revision !== input.expectedRevision)
      throw new PlanningStateConflictError("revision-mismatch", path);
    const next = validatePlanningState(input.next);
    assertPlanningStateReplacement(current, next);
    await this.owned(input.lock, input.issueNumber, current.runId, path);
    await this.write(path, next, true);
    return next;
  }
  private async owned(
    lock: PlanningIssueLock,
    issue: number,
    runId: string,
    path: string,
  ): Promise<void> {
    try {
      await assertPlanningIssueLockOwned(lock, {
        issueNumber: issue,
        runId,
        lockPath: join(
          this.runStateDir,
          "planning-pr-v1",
          "locks",
          `issue-${issue}.lock`,
        ),
      });
    } catch (_error) {
      throw new PlanningStateConflictError(
        resolve(lock.path) !==
          resolve(
            join(
              this.runStateDir,
              "planning-pr-v1",
              "locks",
              `issue-${issue}.lock`,
            ),
          )
          ? "lock-path-mismatch"
          : "lock-ownership-mismatch",
        path,
      );
    }
  }
  private async write(
    path: string,
    state: PlanningStateV1,
    replace: boolean,
  ): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    let renamed = false;
    let handle;
    let primaryFailure: unknown;
    try {
      if (!replace) {
        try {
          await readFile(path);
          throw new PlanningStateConflictError("state-exists", path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(serializePlanningState(state));
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.beforeRename?.(temporary, path);
      await rename(temporary, path);
      renamed = true;
      try {
        const directory = await open(dirname(path), "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      } catch (error) {
        if (
          !["EINVAL", "ENOTSUP", "EPERM"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      }
    } catch (error) {
      primaryFailure = error;
    }
    const failures: unknown[] =
      primaryFailure === undefined ? [] : [primaryFailure];
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch (closeError) {
        failures.push(closeError);
      }
    }
    if (!renamed) {
      try {
        await unlink(temporary);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") {
          failures.push(unlinkError);
        }
      }
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, "Planning state cleanup failed", {
        cause: primaryFailure,
      });
    }
    if (failures.length === 1) throw failures[0];
  }
}
