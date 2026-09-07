export type ForgejoPullRequestErrorCategory =
  | "invalid-input"
  | "command-failed"
  | "invalid-json"
  | "malformed-response";

export type ForgejoPullRequestOperation =
  | "validate-input"
  | "resolve-target-repository"
  | "resolve-remote-repository"
  | "create-pull-request"
  | "list-pull-requests"
  | "get-pull-request"
  | "update-pull-request";

export type ForgejoCommandName = "git" | "tea";
export type ForgejoCommandDiagnostics = Readonly<{
  stdout: string;
  stderr: string;
}>;

export class ForgejoTeaPullRequestError extends Error {
  readonly category: ForgejoPullRequestErrorCategory;
  readonly operation: ForgejoPullRequestOperation;
  readonly command?: ForgejoCommandName;
  readonly exitCode?: number;
  readonly httpStatus?: number;
  declare readonly rawDiagnostics?: ForgejoCommandDiagnostics;

  constructor(input: {
    category: ForgejoPullRequestErrorCategory;
    operation: ForgejoPullRequestOperation;
    command?: ForgejoCommandName;
    exitCode?: number;
    httpStatus?: number;
    rawDiagnostics?: ForgejoCommandDiagnostics;
    cause?: unknown;
  }) {
    super(
      `Forgejo pull request ${input.operation} failed: ${input.category}`,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "ForgejoTeaPullRequestError";
    this.category = input.category;
    this.operation = input.operation;
    if (input.command !== undefined) this.command = input.command;
    if (input.exitCode !== undefined) this.exitCode = input.exitCode;
    if (input.httpStatus !== undefined) this.httpStatus = input.httpStatus;
    if (input.rawDiagnostics !== undefined)
      Object.defineProperty(this, "rawDiagnostics", {
        value: input.rawDiagnostics,
        enumerable: false,
      });
  }
}
