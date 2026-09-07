import type {
  CommandRunner,
  CommandResult,
} from "../cli/commands/triage/types.ts";
import {
  withTeaContext,
  withTeaRepositoryContext,
} from "./forgejo-tea-context.ts";
import {
  ForgejoTeaPullRequestError,
  type ForgejoPullRequestOperation,
} from "./forgejo-tea-pull-request-errors.ts";
import {
  normalizeForgejoRepository,
  parseForgejoRemoteUrl,
  validateForgejoRemoteName,
} from "./forgejo-tea-pull-request-parsing.ts";
import {
  IncompletePullRequestSearchError,
  PullRequestIdentityError,
  PullRequestNotFoundError,
  sameRepositoryIdentity,
  type FindPullRequestsQuery,
  type PullRequestReference,
  type RepositoryIdentity,
} from "./pull-requests.ts";

export type ForgejoTeaPullRequestCommandOptions = {
  runner: CommandRunner;
  repoRoot: string;
  login?: string;
};
type ApiContext = { slug?: string };
const statusLine = /^HTTP\/\d(?:\.\d)?[ \t]+([1-5]\d{2})(?:[ \t]+[^\r\n]*)?$/u;
function status(stderr: string): number | undefined {
  let value: number | undefined;
  for (const line of stderr.split("\n")) {
    const match = statusLine.exec(line.replace(/\r$/u, ""));
    if (match?.[1] !== undefined) value = Number(match[1]);
  }
  return value;
}

export class ForgejoTeaPullRequestCommands {
  readonly options: ForgejoTeaPullRequestCommandOptions;
  constructor(options: ForgejoTeaPullRequestCommandOptions) {
    this.options = options;
  }

  private async run(
    operation: ForgejoPullRequestOperation,
    command: "git" | "tea",
    args: string[],
  ): Promise<CommandResult> {
    try {
      return await this.options.runner.run(command, args, {
        cwd: this.options.repoRoot,
      });
    } catch {
      throw new ForgejoTeaPullRequestError({
        category: "command-failed",
        operation,
        command,
      });
    }
  }

  private async api(
    operation: ForgejoPullRequestOperation,
    args: string[],
    context: ApiContext = {},
    notFoundReference?: PullRequestReference,
  ): Promise<CommandResult> {
    const argsWithHeaders = [...args, "--include"];
    const commandArgs =
      context.slug === undefined
        ? withTeaContext(
            argsWithHeaders,
            this.options.repoRoot,
            this.options.login,
          )
        : withTeaRepositoryContext(
            argsWithHeaders,
            context.slug,
            this.options.login,
          );
    const result = await this.run(operation, "tea", commandArgs);
    const httpStatus = status(result.stderr);
    if (
      result.code !== 0 &&
      httpStatus === 404 &&
      notFoundReference !== undefined
    )
      throw new PullRequestNotFoundError(notFoundReference);
    if (result.code !== 0 || (httpStatus !== undefined && httpStatus >= 400))
      throw new ForgejoTeaPullRequestError({
        category: "command-failed",
        operation,
        command: "tea",
        exitCode: result.code,
        ...(httpStatus === undefined ? {} : { httpStatus }),
        rawDiagnostics: result,
      });
    return result;
  }
  private async json(
    operation: ForgejoPullRequestOperation,
    args: string[],
    context: ApiContext = {},
    notFoundReference?: PullRequestReference,
  ): Promise<unknown> {
    const result = await this.api(operation, args, context, notFoundReference);
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new ForgejoTeaPullRequestError({
        category: "invalid-json",
        operation,
        command: "tea",
        rawDiagnostics: result,
      });
    }
  }

  async resolveTargetRepositoryIdentity(): Promise<RepositoryIdentity> {
    return normalizeForgejoRepository(
      await this.json("resolve-target-repository", [
        "api",
        "/repos/{owner}/{repo}",
      ]),
      { operation: "resolve-target-repository" },
    );
  }
  async resolveRemoteRepositoryIdentity(
    remote: string,
  ): Promise<RepositoryIdentity> {
    validateForgejoRemoteName(remote);
    const result = await this.run("resolve-remote-repository", "git", [
      "remote",
      "get-url",
      "--push",
      "--all",
      "--",
      remote,
    ]);
    if (result.code !== 0)
      throw new ForgejoTeaPullRequestError({
        category: "command-failed",
        operation: "resolve-remote-repository",
        command: "git",
        exitCode: result.code,
        rawDiagnostics: result,
      });
    const urls = result.stdout
      .split(/\r?\n/u)
      .filter((url) => url.trim() !== "");
    if (!urls.length)
      throw new ForgejoTeaPullRequestError({
        category: "malformed-response",
        operation: "resolve-remote-repository",
        command: "git",
        rawDiagnostics: result,
      });
    const identities = await Promise.all(
      urls.map(async (url) => {
        const source = parseForgejoRemoteUrl(url);
        const identity = normalizeForgejoRepository(
          await this.json(
            "resolve-remote-repository",
            ["api", "/repos/{owner}/{repo}"],
            { slug: source.slug },
          ),
          { operation: "resolve-remote-repository", expectedHost: source.host },
        );
        return identity;
      }),
    );
    const identity = identities[0];
    if (!identity)
      throw new ForgejoTeaPullRequestError({
        category: "malformed-response",
        operation: "resolve-remote-repository",
      });
    if (
      identities.some(
        (candidate) => !sameRepositoryIdentity(candidate, identity),
      )
    )
      throw new PullRequestIdentityError("push remote URLs disagree");
    return identity;
  }
  createPullRequestPayload(input: {
    baseBranch: string;
    headOwner: string;
    headBranch: string;
    title: string;
    body: string;
  }): Promise<unknown> {
    return this.json("create-pull-request", [
      "api",
      "/repos/{owner}/{repo}/pulls",
      "--method",
      "POST",
      "--field",
      `base=${input.baseBranch}`,
      "--field",
      `head=${input.headOwner}:${input.headBranch}`,
      "--field",
      `title=${input.title}`,
      "--field",
      `body=${input.body}`,
    ]);
  }
  async listPullRequests<T>(input: {
    query: FindPullRequestsQuery;
    normalize: (payload: unknown) => T;
  }): Promise<readonly T[]> {
    const found: T[] = [];
    let page = 1;
    while (true) {
      const raw = await this.json("list-pull-requests", [
        "api",
        `/repos/{owner}/{repo}/pulls?state=all&page=${page}&limit=50`,
      ]);
      if (!Array.isArray(raw))
        throw new ForgejoTeaPullRequestError({
          category: "malformed-response",
          operation: "list-pull-requests",
        });
      found.push(...raw.map(input.normalize));
      if (raw.length < 50) return found;
      if (!Number.isSafeInteger(page + 1) || page + 1 <= 0)
        throw new IncompletePullRequestSearchError(input.query);
      page += 1;
    }
  }
  getPullRequestPayload(reference: PullRequestReference): Promise<unknown> {
    return this.json(
      "get-pull-request",
      ["api", `/repos/{owner}/{repo}/pulls/${reference.number}`],
      {},
      reference,
    );
  }
  async updatePullRequestBody(
    reference: PullRequestReference,
    body: string,
  ): Promise<void> {
    await this.json("update-pull-request", [
      "api",
      `/repos/{owner}/{repo}/pulls/${reference.number}`,
      "--method",
      "PATCH",
      "--field",
      `body=${body}`,
    ]);
  }
}
