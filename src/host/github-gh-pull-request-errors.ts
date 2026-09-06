import type { CommandResult } from "../process/command.ts";

export type GitHubPullRequestInputReason =
  | "blank-push-remote"
  | "invalid-discovery-limit"
  | "invalid-pull-request-number"
  | "blank-head-branch"
  | "qualified-head-branch"
  | "invalid-head-branch";
export type GitHubPullRequestCommandOperation =
  | "resolve-target-repository"
  | "read-push-remote-urls"
  | "resolve-push-repository"
  | "probe-pull-request"
  | "create-pull-request"
  | "list-pull-requests"
  | "view-pull-request"
  | "edit-pull-request";
export type GitHubPullRequestResponseReason =
  | "remote-url-list"
  | "remote-url"
  | "repository-payload"
  | "pull-request-existence-payload"
  | "pull-request-payload"
  | "pull-request-state"
  | "pull-request-url"
  | "pull-request-list"
  | "pull-request-create-output";

export class GitHubPullRequestInputError extends Error {
  readonly code = "github-pull-request-invalid-input" as const;
  readonly reason: GitHubPullRequestInputReason;
  constructor(reason: GitHubPullRequestInputReason, message: string) {
    super(message);
    this.name = "GitHubPullRequestInputError";
    this.reason = reason;
  }
}
export class GitHubPullRequestCommandError extends Error {
  readonly code = "github-pull-request-command-failed" as const;
  readonly reason: "authentication-required" | "command-failed";
  readonly exitCode: number;
  declare readonly diagnostics: Readonly<CommandResult>;
  readonly operation: GitHubPullRequestCommandOperation;
  readonly command: "git" | "gh";
  constructor(
    operation: GitHubPullRequestCommandOperation,
    command: "git" | "gh",
    result: CommandResult,
  ) {
    super(`${operation} failed with exit code ${result.code}`);
    this.operation = operation;
    this.command = command;
    this.name = "GitHubPullRequestCommandError";
    this.reason =
      command === "gh" && result.code === 4
        ? "authentication-required"
        : "command-failed";
    this.exitCode = result.code;
    Object.defineProperty(this, "diagnostics", {
      value: Object.freeze({ ...result }),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}
export class GitHubPullRequestJsonError extends Error {
  readonly code = "github-pull-request-invalid-json" as const;
  override readonly cause: SyntaxError;
  readonly context: string;
  constructor(context: string, cause: SyntaxError) {
    super(`${context} returned invalid JSON`, { cause });
    this.name = "GitHubPullRequestJsonError";
    this.context = context;
    this.cause = cause;
  }
}
export class GitHubPullRequestResponseError extends Error {
  readonly code = "github-pull-request-malformed-response" as const;
  readonly reason: GitHubPullRequestResponseReason;
  readonly context: string;
  constructor(reason: GitHubPullRequestResponseReason, context: string) {
    super(`${context} returned a malformed response: ${reason}`);
    this.name = "GitHubPullRequestResponseError";
    this.reason = reason;
    this.context = context;
  }
}
