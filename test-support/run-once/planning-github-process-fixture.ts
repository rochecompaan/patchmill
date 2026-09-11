import type { CommandResult } from "../../src/cli/commands/run-once/types.ts";
import { labelListPayload } from "./issue-fixtures.ts";
import type {
  PlanningProviderFixtureInput,
  PlanningScenarioPull,
} from "./planning-provider-scenario-types.ts";

export type PlanningGithubPull = Readonly<{
  number: number;
  branch: string;
  body: string;
  headOid: string;
  merged?: boolean;
  closed?: boolean;
  mergeOid?: string;
}>;

export type GithubProcessFixtureInput = PlanningProviderFixtureInput;

function fixtureError(args: readonly string[]): never {
  throw new Error(`unexpected gh command: ${args.join(" ")}`);
}

function argument(args: readonly string[], flag: string) {
  const value = args[args.indexOf(flag) + 1];
  if (value === undefined) fixtureError(args);
  return value;
}

export function githubPullPayload(
  pull: PlanningGithubPull | PlanningScenarioPull,
) {
  return {
    number: pull.number,
    url: `https://github.test/acme/patchmill/pull/${pull.number}`,
    body: pull.body,
    state: pull.merged ? "MERGED" : pull.closed ? "CLOSED" : "OPEN",
    mergeCommit: pull.mergeOid ? { oid: pull.mergeOid } : null,
    baseRefName: "main",
    headRefName: pull.branch,
    headRefOid: pull.headOid,
    headRepository: { nameWithOwner: "acme/patchmill" },
  };
}

export function githubResult(stdout: unknown): CommandResult {
  return { code: 0, stdout: JSON.stringify(stdout), stderr: "" };
}

/** Parses only the gh commands emitted by GitHubGhPullRequestHost. */
export function createGithubProcessFixture(input: GithubProcessFixtureInput) {
  return async (args: string[]): Promise<CommandResult> => {
    const [group, action] = args;
    if ((group === "pr" || group === "api") && input.consumeHostReadFailure())
      return { code: 1, stdout: "", stderr: "transient host failure" };
    const issue = {
      number: input.issue.number,
      title: input.issue.title,
      body: input.issue.body,
      state: input.issue.state,
      labels: input.issue.labels.map((name) => ({ name })),
      author: { login: input.issue.author },
      updatedAt: input.issue.updated,
      comments: input.issue.comments,
      url: "https://github.test/acme/patchmill/issues/190",
    };
    if (group === "issue" && action === "list") {
      input.record({ kind: "read", operation: "issue-read" });
      return githubResult([issue]);
    }
    if (group === "issue" && action === "view") {
      input.record({ kind: "read", operation: "issue-read" });
      return githubResult(issue);
    }
    if (group === "label" && action === "list") {
      input.record({ kind: "read", operation: "repository-read" });
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (group === "issue" && action === "comment") {
      const handoff = await input.implementationFinish();
      input.record({
        kind: "write",
        operation: handoff ? "handoff-comment" : "issue-comment",
      });
      if (handoff) await input.interrupt("after-handoff-comment");
      input.addIssueComment(argument(args, "--body"));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (group === "issue" && action === "edit") {
      const done = await input.implementationFinish();
      input.record({
        kind: "write",
        operation: done ? "done-label" : "issue-label-edit",
      });
      if (done) await input.interrupt("after-done-label");
      input.updateIssueLabels(
        args.flatMap((value, index) =>
          value === "--add-label" ? [args[index + 1]!] : [],
        ),
        args.flatMap((value, index) =>
          value === "--remove-label" ? [args[index + 1]!] : [],
        ),
      );
      return { code: 0, stdout: "", stderr: "" };
    }
    if (group === "repo" && action === "view") {
      input.record({ kind: "read", operation: "repository-read" });
      return githubResult({
        nameWithOwner: "acme/patchmill",
        url: "https://github.test/acme/patchmill",
      });
    }
    if (group === "api" && action === "graphql") {
      input.record({ kind: "read", operation: "pull-request-read" });
      const number = Number(
        args.find((value) => value.startsWith("number="))?.slice(7),
      );
      const found = input.pulls.some((pull) => pull.number === number);
      return {
        code: found ? 0 : 1,
        stdout: JSON.stringify({
          data: {
            repository: {
              nameWithOwner: "acme/patchmill",
              pullRequest: found ? { number } : null,
            },
          },
          ...(found
            ? {}
            : {
                errors: [
                  { type: "NOT_FOUND", path: ["repository", "pullRequest"] },
                ],
              }),
        }),
        stderr: "",
      };
    }
    if (group === "pr" && action === "list") {
      input.record({ kind: "read", operation: "pull-request-read" });
      const branch = argument(args, "--head");
      return githubResult(
        input.pulls
          .filter((pull) => pull.branch === branch)
          .map(githubPullPayload),
      );
    }
    if (group === "pr" && action === "view") {
      input.record({ kind: "read", operation: "pull-request-read" });
      const number = Number(args[2]);
      const pull = input.pulls.find((item) => item.number === number);
      if (pull === undefined)
        return { code: 1, stdout: "", stderr: "not found" };
      if (number === 99)
        await input.interrupt("after-implementation-pull-request-validation");
      return githubResult(githubPullPayload(pull));
    }
    if (group === "pr" && action === "create") {
      const branch = argument(args, "--head").split(":").at(-1)!;
      const pull = {
        number: input.nextPull(),
        branch,
        body: argument(args, "--body"),
        headOid: await input.headOid(branch),
        headRepository: "acme/patchmill",
      };
      input.pulls.push(pull);
      input.record({
        kind: "write",
        operation: "planning-pull-request-create",
      });
      await input.interrupt("after-planning-pull-request-create");
      return {
        code: 0,
        stdout: `https://github.test/acme/patchmill/pull/${pull.number}\n`,
        stderr: "",
      };
    }
    if (group === "pr" && action === "edit") {
      input.record({ kind: "write", operation: "pull-request-edit" });
      return { code: 0, stdout: "", stderr: "" };
    }
    return fixtureError(args);
  };
}
