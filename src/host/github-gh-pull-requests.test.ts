import assert from "node:assert/strict";
import test from "node:test";
import type {
  CommandResult,
  CommandRunOptions,
  CommandRunner,
} from "../process/command.ts";
import {
  PullRequestNotFoundError,
  type RepositoryIdentity,
} from "./pull-requests.ts";
import {
  GitHubPullRequestCommandError,
  GitHubPullRequestInputError,
} from "./github-gh-pull-request-errors.ts";
import { GitHubGhPullRequestHost } from "./github-gh-pull-requests.ts";

type Call = { command: string; args: string[]; options?: CommandRunOptions };
const key = (command: string, args: string[]) =>
  JSON.stringify([command, args]);
class Runner implements CommandRunner {
  calls: Call[] = [];
  private readonly results: Map<string, CommandResult[]>;
  constructor(results: Map<string, CommandResult[]>) {
    this.results = results;
  }
  async run(
    command: string,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<CommandResult> {
    this.calls.push({ command, args: [...args], options });
    const result = this.results.get(key(command, args))?.shift();
    assert.ok(result, `unexpected ${command} ${args.join(" ")}`);
    return result;
  }
}
const ok = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });
const target: RepositoryIdentity = {
  provider: "github-gh",
  host: "github.com",
  owner: "acme",
  repository: "project",
};
const targetPayload = JSON.stringify({
  nameWithOwner: "acme/project",
  url: "https://github.com/acme/project",
});
const repository = ["repo", "view", "--json", "nameWithOwner,url"];
const remote = ["remote", "get-url", "--push", "--all", "--", "publish"];
const remoteRepo = [
  "repo",
  "view",
  "github.com/acme/project",
  "--json",
  "nameWithOwner,url",
];
const gql =
  "query PatchmillPullRequestExists($owner: String!, $repository: String!, $number: Int!) { repository(owner: $owner, name: $repository) { nameWithOwner pullRequest(number: $number) { number } } }";
const existence = [
  "api",
  "graphql",
  "--hostname",
  "github.com",
  "--raw-field",
  `query=${gql}`,
  "--field",
  "owner=acme",
  "--field",
  "repository=project",
  "--field",
  "number=42",
];
const fields =
  "number,url,state,mergeCommit,baseRefName,headRefName,headRefOid,headRepository,body";
const view = [
  "pr",
  "view",
  "42",
  "--repo",
  "github.com/acme/project",
  "--json",
  fields,
];
const payload = JSON.stringify({
  number: 42,
  url: "https://github.com/acme/project/pull/42",
  state: "OPEN",
  mergeCommit: null,
  baseRefName: "main",
  headRefName: "agent/change",
  headRefOid: "abc",
  headRepository: { nameWithOwner: "acme/project" },
  body: "body",
});
function setup(extra: [string, string[], CommandResult][] = []): Runner {
  const entries: [string, CommandResult[]][] = [
    [key("gh", repository), [ok(targetPayload)]],
    [key("git", remote), [ok("git@github.com:acme/project.git\n")]],
    [key("gh", remoteRepo), [ok(targetPayload)]],
  ];
  for (const [command, args, result] of extra) {
    const found = entries.find(([entry]) => entry === key(command, args));
    if (found) found[1].push(result);
    else entries.push([key(command, args), [result]]);
  }
  return new Runner(new Map(entries));
}
test("rejects invalid options and public reference input before commands", async () => {
  for (const options of [
    { pushRemote: " " },
    { pushRemote: "publish", discoveryLimit: 0 },
    { pushRemote: "publish", discoveryLimit: 1.5 },
  ]) {
    assert.throws(
      () =>
        new GitHubGhPullRequestHost({
          runner: new Runner(new Map()),
          repoRoot: "/repo",
          ...options,
        }),
      GitHubPullRequestInputError,
    );
  }
  const runner = new Runner(new Map());
  const host = new GitHubGhPullRequestHost({
    runner,
    repoRoot: "/repo",
    pushRemote: "publish",
  });
  await assert.rejects(
    host.readPullRequestBody({ targetRepository: target, number: 0 }),
    GitHubPullRequestInputError,
  );
  assert.deepEqual(runner.calls, []);
});

test("resolves leading-hyphen remotes and preserves command-error diagnostics", async () => {
  const read = ["remote", "get-url", "--push", "--all", "--", "-publish"];
  const selector = [
    "repo",
    "view",
    "github.example.com/old/project",
    "--json",
    "nameWithOwner,url",
  ];
  const runner = new Runner(
    new Map([
      [key("git", read), [ok("git@github.example.com:old/project.git\n")]],
      [
        key("gh", selector),
        [
          ok(
            JSON.stringify({
              nameWithOwner: "new/project",
              url: "https://github.example.com/new/project",
            }),
          ),
        ],
      ],
    ]),
  );
  const host = new GitHubGhPullRequestHost({
    runner,
    repoRoot: "/repo",
    pushRemote: "-publish",
  });
  assert.deepEqual(await host.resolveRemoteRepositoryIdentity("-publish"), {
    provider: "github-gh",
    host: "github.example.com",
    owner: "new",
    repository: "project",
  });
  const failed = new Runner(
    new Map([
      [
        key("gh", repository),
        [{ code: 4, stdout: "secret-token", stderr: "authentication failed" }],
      ],
    ]),
  );
  await assert.rejects(
    new GitHubGhPullRequestHost({
      runner: failed,
      repoRoot: "/repo",
      pushRemote: "publish",
    }).resolveTargetRepositoryIdentity(),
    (error: unknown) => {
      assert.ok(error instanceof GitHubPullRequestCommandError);
      assert.equal(error.reason, "authentication-required");
      assert.equal(error.operation, "resolve-target-repository");
      assert.equal(
        Object.prototype.propertyIsEnumerable.call(error, "diagnostics"),
        false,
      );
      assert.match(error.diagnostics.stdout, /secret-token/u);
      assert.doesNotMatch(JSON.stringify(error), /secret-token/u);
      return true;
    },
  );
});

test("gets a validated same-repository pull request using exact GitHub commands", async () => {
  const runner = setup([
    [
      "gh",
      existence,
      ok(
        JSON.stringify({
          data: {
            repository: {
              nameWithOwner: "acme/project",
              pullRequest: { number: 42 },
            },
          },
        }),
      ),
    ],
    ["gh", view, ok(payload)],
  ]);
  const host = new GitHubGhPullRequestHost({
    runner,
    repoRoot: "/repo",
    pushRemote: "publish",
  });
  assert.equal(
    (await host.getPullRequest({ targetRepository: target, number: 42 })).body,
    "body",
  );
  assert.deepEqual(
    runner.calls.map((call) => [call.command, call.args]),
    [
      ["gh", repository],
      ["git", remote],
      ["gh", remoteRepo],
      ["gh", existence],
      ["gh", view],
    ],
  );
  assert.deepEqual(
    runner.calls
      .filter((call) => call.command === "gh")
      .map((call) => call.options?.env),
    Array(4).fill({ GH_REPO: undefined }),
  );
});
test("classifies only the exact exit-one missing payload as not found", async () => {
  const missing = JSON.stringify({
    data: { repository: { nameWithOwner: "acme/project", pullRequest: null } },
    errors: [{ type: "NOT_FOUND", path: ["repository", "pullRequest"] }],
  });
  const runner = setup([
    ["gh", existence, { code: 1, stdout: missing, stderr: "ignored" }],
  ]);
  const host = new GitHubGhPullRequestHost({
    runner,
    repoRoot: "/repo",
    pushRemote: "publish",
  });
  await assert.rejects(
    host.getPullRequest({ targetRepository: target, number: 42 }),
    PullRequestNotFoundError,
  );
});
test("reads bodies and discovers exact pull requests with explicit all-state limit", async () => {
  const list = [
    "pr",
    "list",
    "--repo",
    "github.com/acme/project",
    "--state",
    "all",
    "--base",
    "main",
    "--head",
    "agent/change",
    "--limit",
    "1000",
    "--json",
    fields,
  ];
  const present = ok(
    JSON.stringify({
      data: {
        repository: {
          nameWithOwner: "acme/project",
          pullRequest: { number: 42 },
        },
      },
    }),
  );
  const runner = setup([
    ["gh", existence, present],
    ["gh", view, ok(payload)],
    ["gh", repository, ok(targetPayload)],
    ["git", remote, ok("git@github.com:acme/project.git\n")],
    ["gh", remoteRepo, ok(targetPayload)],
    ["gh", list, ok(`[${payload}]`)],
  ]);
  const host = new GitHubGhPullRequestHost({
    runner,
    repoRoot: "/repo",
    pushRemote: "publish",
  });
  assert.equal(
    await host.readPullRequestBody({ targetRepository: target, number: 42 }),
    "body",
  );
  assert.equal(
    (
      await host.findPullRequests({
        targetRepository: target,
        baseBranch: "main",
        headRepository: target,
        headBranch: "agent/change",
      })
    ).length,
    1,
  );
  assert.ok(
    runner.calls.some(
      (call) => key(call.command, call.args) === key("gh", list),
    ),
  );
});

test("updates using the provider-normalized target after case-insensitive validation", async () => {
  const callerTarget = { ...target, owner: "ACME", repository: "PROJECT" };
  const callerExistence = existence.map((argument) =>
    argument === "owner=acme"
      ? "owner=ACME"
      : argument === "repository=project"
        ? "repository=PROJECT"
        : argument,
  );
  const edit = [
    "pr",
    "edit",
    "42",
    "--repo",
    "github.com/acme/project",
    "--body",
    "updated",
  ];
  const runner = setup([
    [
      "gh",
      callerExistence,
      ok(
        JSON.stringify({
          data: {
            repository: {
              nameWithOwner: "acme/project",
              pullRequest: { number: 42 },
            },
          },
        }),
      ),
    ],
    ["gh", view, ok(payload)],
    ["gh", edit, ok()],
  ]);
  await new GitHubGhPullRequestHost({
    runner,
    repoRoot: "/repo",
    pushRemote: "publish",
  }).updatePullRequestBody(
    { targetRepository: callerTarget, number: 42 },
    "updated",
  );
  assert.ok(
    runner.calls.some(
      (call) => key(call.command, call.args) === key("gh", edit),
    ),
  );
});

test("creates with the resolved owner and updates from the normalized summary", async () => {
  const create = [
    "pr",
    "create",
    "--repo",
    "github.com/acme/project",
    "--base",
    "main",
    "--head",
    "acme:agent/change",
    "--title",
    "title",
    "--body",
    "body",
  ];
  const edit = [
    "pr",
    "edit",
    "42",
    "--repo",
    "github.com/acme/project",
    "--body",
    "updated\nbody",
  ];
  const present = ok(
    JSON.stringify({
      data: {
        repository: {
          nameWithOwner: "acme/project",
          pullRequest: { number: 42 },
        },
      },
    }),
  );
  const runner = setup([
    ["gh", create, ok("https://github.com/acme/project/pull/42\n")],
    ["gh", existence, present],
    ["gh", view, ok(payload)],
    ["gh", repository, ok(targetPayload)],
    ["git", remote, ok("git@github.com:acme/project.git\n")],
    ["gh", remoteRepo, ok(targetPayload)],
    ["gh", existence, present],
    ["gh", view, ok(payload)],
    ["gh", edit, ok()],
  ]);
  const host = new GitHubGhPullRequestHost({
    runner,
    repoRoot: "/repo",
    pushRemote: "publish",
  });
  await host.createPullRequest({
    title: "title",
    body: "body",
    baseBranch: "main",
    headBranch: "agent/change",
  });
  await host.updatePullRequestBody(
    { targetRepository: target, number: 42 },
    "updated\nbody",
  );
  assert.ok(
    runner.calls.some(
      (call) => key(call.command, call.args) === key("gh", edit),
    ),
  );
});
