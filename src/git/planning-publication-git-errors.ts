import type { CommandResult } from "../command/types.ts";

export type PlanningPublicationGitOperation =
  | "head"
  | "ancestry"
  | "tree"
  | "diff"
  | "status"
  | "remote-head"
  | "push";
export type PlanningPublicationGitReason =
  | "invalid-input"
  | "invalid-workspace"
  | "command-failed"
  | "malformed-response"
  | "head-mismatch"
  | "not-ancestor"
  | "non-regular-file"
  | "dirty-workspace"
  | "unexpected-changes"
  | "conflicting-head"
  | "invalid-companion";
export class PlanningPublicationGitError extends Error {
  readonly operation: PlanningPublicationGitOperation;
  readonly reason: PlanningPublicationGitReason;
  readonly exitCode?: number;
  constructor(
    operation: PlanningPublicationGitOperation,
    reason: PlanningPublicationGitReason,
    result?: CommandResult,
  ) {
    super(`Planning publication Git failed: ${operation}/${reason}`);
    this.name = "PlanningPublicationGitError";
    this.operation = operation;
    this.reason = reason;
    if (result !== undefined) {
      this.exitCode = result.code;
      Object.defineProperty(this, "diagnostics", {
        enumerable: false,
        value: Object.freeze({ ...result }),
      });
    }
  }
  declare readonly diagnostics: Readonly<CommandResult>;
}
