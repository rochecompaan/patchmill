import assert from "node:assert/strict";
import test from "node:test";
import type {
  CommandResult,
  CommandRunOptions,
  CommandRunner,
} from "../process/command.ts";
import {
  IncompletePullRequestSearchError,
  PullRequestIdentityError,
  PullRequestNotFoundError,
  type RepositoryIdentity,
} from "./pull-requests.ts";
import {
  GitHubPullRequestCommandError,
  GitHubPullRequestInputError,
  GitHubPullRequestJsonError,
  GitHubPullRequestResponseError,
} from "./github-gh-pull-request-errors.ts";
import { GitHubGhPullRequestHost } from "./github-gh-pull-requests.ts";

type Call = { command: string; args: string[]; options?: CommandRunOptions };
type ScriptedResult = CommandResult | Promise<CommandResult>;
const key = (command: string, args: string[]) =>
  JSON.stringify([command, args]);
class Runner implements CommandRunner {
  calls: Call[] = [];
  private readonly results: Map<string, ScriptedResult[]>;
  constructor(results: Map<string, ScriptedResult[]>) {
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
function setup(
  extra: [string, string[], ScriptedResult][] = [],
  remoteUrls = "git@github.com:acme/project.git\n",
  remotePayload = targetPayload,
): Runner {
  const entries: [string, ScriptedResult[]][] = [
    [key("gh", repository), [ok(targetPayload)]],
    [key("git", remote), [ok(remoteUrls)]],
    [
      key("gh", remoteRepo),
      Array.from({ length: remoteUrls.trim().split(/\r?\n/u).length }, () =>
        ok(remotePayload),
      ),
    ],
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

test("rejects invalid public operation input before commands", async () => {
  for (const operation of ["get", "read", "update"] as const) {
    const runner = new Runner(new Map());
    const host = new GitHubGhPullRequestHost({
      runner,
      repoRoot: "/repo",
      pushRemote: "publish",
    });
    const reference = { targetRepository: target, number: 0 };
    if (operation === "get")
      assert.throws(
        () => host.getPullRequest(reference),
        GitHubPullRequestInputError,
      );
    else if (operation === "read")
      await assert.rejects(
        host.readPullRequestBody(reference),
        GitHubPullRequestInputError,
      );
    else
      await assert.rejects(
        host.updatePullRequestBody(reference, "body"),
        GitHubPullRequestInputError,
      );
    assert.deepEqual(runner.calls, []);
  }
  for (const operation of ["create", "find"] as const) {
    const runner = new Runner(new Map());
    const host = new GitHubGhPullRequestHost({
      runner,
      repoRoot: "/repo",
      pushRemote: "publish",
    });
    if (operation === "create")
      await assert.rejects(
        host.createPullRequest({
          title: "title",
          body: "body",
          baseBranch: "main",
          headBranch: "owner:branch",
        }),
        GitHubPullRequestInputError,
      );
    else
      await assert.rejects(
        host.findPullRequests({
          targetRepository: target,
          baseBranch: "main",
          headRepository: target,
          headBranch: "owner:branch",
        }),
        GitHubPullRequestInputError,
      );
    assert.deepEqual(runner.calls, []);
  }
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

test("resolves every configured push destination sequentially", async () => {
  const urls =
    "git@github.com:acme/project.git\nhttps://github.com/acme/project.git\n";
  const runner = setup([], urls);
  assert.deepEqual(
    await new GitHubGhPullRequestHost({
      runner,
      repoRoot: "/repo",
      pushRemote: "publish",
    }).resolveRemoteRepositoryIdentity("publish"),
    target,
  );
  assert.equal(
    runner.calls.filter(
      (call) => key(call.command, call.args) === key("gh", remoteRepo),
    ).length,
    2,
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
  const index = (command: string, args: string[]) =>
    runner.calls.findIndex(
      (call) => key(call.command, call.args) === key(command, args),
    );
  const targetIndex = index("gh", repository);
  const remoteIndex = index("git", remote);
  const remoteRepositoryIndex = index("gh", remoteRepo);
  const existenceIndex = index("gh", existence);
  const viewIndex = index("gh", view);
  assert.ok(targetIndex >= 0 && remoteIndex >= 0);
  assert.ok(remoteIndex < remoteRepositoryIndex);
  assert.ok(Math.max(targetIndex, remoteRepositoryIndex) < existenceIndex);
  assert.ok(existenceIndex < viewIndex);
  for (const call of runner.calls) {
    assert.equal(call.options?.cwd, "/repo");
    if (call.command === "gh")
      assert.deepEqual(call.options?.env, { GH_REPO: undefined });
  }
});
test("uses host-qualified GitHub Enterprise commands", async () => {
  const enterprise = {
    provider: "github-gh" as const,
    host: "github.example.com",
    owner: "Platform",
    repository: "Project",
  };
  const enterprisePayload = JSON.stringify({
    nameWithOwner: "Platform/Project",
    url: "https://github.example.com/Platform/Project",
  });
  const enterpriseRepository = ["repo", "view", "--json", "nameWithOwner,url"];
  const enterpriseRemote = [
    "remote",
    "get-url",
    "--push",
    "--all",
    "--",
    "publish",
  ];
  const enterpriseRemoteRepository = [
    "repo",
    "view",
    "github.example.com/Platform/Project",
    "--json",
    "nameWithOwner,url",
  ];
  const enterpriseExistence = [
    "api",
    "graphql",
    "--hostname",
    "github.example.com",
    "--raw-field",
    `query=${gql}`,
    "--field",
    "owner=Platform",
    "--field",
    "repository=Project",
    "--field",
    "number=42",
  ];
  const enterpriseView = [
    "pr",
    "view",
    "42",
    "--repo",
    "github.example.com/Platform/Project",
    "--json",
    fields,
  ];
  const runner = new Runner(
    new Map([
      [key("gh", enterpriseRepository), [ok(enterprisePayload)]],
      [
        key("git", enterpriseRemote),
        [ok("git@github.example.com:Platform/Project.git\n")],
      ],
      [key("gh", enterpriseRemoteRepository), [ok(enterprisePayload)]],
      [
        key("gh", enterpriseExistence),
        [
          ok(
            JSON.stringify({
              data: {
                repository: {
                  nameWithOwner: "Platform/Project",
                  pullRequest: { number: 42 },
                },
              },
            }),
          ),
        ],
      ],
      [
        key("gh", enterpriseView),
        [
          ok(
            JSON.stringify({
              ...JSON.parse(payload),
              url: "https://github.example.com/Platform/Project/pull/42",
              headRepository: { nameWithOwner: "Platform/Project" },
            }),
          ),
        ],
      ],
    ]),
  );
  await new GitHubGhPullRequestHost({
    runner,
    repoRoot: "/repo",
    pushRemote: "publish",
  }).getPullRequest({ targetRepository: enterprise, number: 42 });
  assert.ok(
    runner.calls.some(
      (call) => key(call.command, call.args) === key("gh", enterpriseExistence),
    ),
  );
  assert.ok(
    runner.calls.some(
      (call) => key(call.command, call.args) === key("gh", enterpriseView),
    ),
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

test("starts remote resolution while target resolution is pending", async () => {
  const targetGate = Promise.withResolvers<CommandResult>();
  const remoteFinished = Promise.withResolvers<void>();
  const runner = new Runner(
    new Map([
      [key("gh", repository), [targetGate.promise]],
      [key("git", remote), [ok("git@github.com:acme/project.git\n")]],
      [
        key("gh", remoteRepo),
        [
          Promise.resolve(targetPayload).then((stdout) => {
            remoteFinished.resolve();
            return ok(stdout);
          }),
        ],
      ],
      [
        key("gh", existence),
        [
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
      ],
      [key("gh", view), [ok(payload)]],
    ]),
  );
  const pending = new GitHubGhPullRequestHost({
    runner,
    repoRoot: "/repo",
    pushRemote: "publish",
  }).getPullRequest({ targetRepository: target, number: 42 });
  assert.equal(
    await Promise.race([
      remoteFinished.promise.then(() => true),
      new Promise<boolean>((resolve) => setImmediate(() => resolve(false))),
    ]),
    true,
  );
  assert.equal(
    runner.calls.some((call) => call.args[0] === "api"),
    false,
  );
  targetGate.resolve(ok(targetPayload));
  await pending;
});

test("rejects mismatched push destinations before create and update mutations", async () => {
  const otherPayload = JSON.stringify({
    nameWithOwner: "other/project",
    url: "https://github.com/other/project",
  });
  for (const operation of ["create", "update"] as const) {
    const runner = setup([], undefined, otherPayload);
    const host = new GitHubGhPullRequestHost({
      runner,
      repoRoot: "/repo",
      pushRemote: "publish",
    });
    if (operation === "create") {
      await assert.rejects(
        host.createPullRequest({
          title: "title",
          body: "body",
          baseBranch: "main",
          headBranch: "agent/change",
        }),
        PullRequestIdentityError,
      );
    } else {
      await assert.rejects(
        host.updatePullRequestBody(
          { targetRepository: target, number: 42 },
          "body",
        ),
        PullRequestIdentityError,
      );
    }
    assert.equal(
      runner.calls.some(
        (call) => call.command === "gh" && call.args[0] === "pr",
      ),
      false,
    );
  }
});

test("fails closed for ambiguous discovery and malformed create, list, and view results", async () => {
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
    "1",
    "--json",
    fields,
  ];
  const discovery = new GitHubGhPullRequestHost({
    runner: setup([["gh", list, ok(`[${payload}]`)]], undefined, undefined),
    repoRoot: "/repo",
    pushRemote: "publish",
    discoveryLimit: 1,
  });
  await assert.rejects(
    discovery.findPullRequests({
      targetRepository: target,
      baseBranch: "main",
      headRepository: target,
      headBranch: "agent/change",
    }),
    IncompletePullRequestSearchError,
  );

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
  await assert.rejects(
    new GitHubGhPullRequestHost({
      runner: setup([["gh", create, ok("not-a-url")]]),
      repoRoot: "/repo",
      pushRemote: "publish",
    }).createPullRequest({
      title: "title",
      body: "body",
      baseBranch: "main",
      headBranch: "agent/change",
    }),
    GitHubPullRequestResponseError,
  );

  for (const [command, args, result] of [
    ["gh", list, ok("not-json")],
    ["gh", view, ok("not-json")],
  ] as [string, string[], CommandResult][]) {
    const runner = setup(
      args === view
        ? [
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
            [command, args, result],
          ]
        : [[command, args, result]],
    );
    const host = new GitHubGhPullRequestHost({
      runner,
      repoRoot: "/repo",
      pushRemote: "publish",
      ...(args === list ? { discoveryLimit: 1 } : {}),
    });
    if (args === list) {
      await assert.rejects(
        host.findPullRequests({
          targetRepository: target,
          baseBranch: "main",
          headRepository: target,
          headBranch: "agent/change",
        }),
        GitHubPullRequestJsonError,
      );
    } else {
      await assert.rejects(
        host.getPullRequest({ targetRepository: target, number: 42 }),
        GitHubPullRequestJsonError,
      );
    }
  }
});

test("does not classify the absence payload as missing for exit codes zero, two, or four", async () => {
  const missing = JSON.stringify({
    data: { repository: { nameWithOwner: "acme/project", pullRequest: null } },
    errors: [{ type: "NOT_FOUND", path: ["repository", "pullRequest"] }],
  });
  for (const code of [0, 2, 4]) {
    const runner = setup([
      ["gh", existence, { code, stdout: missing, stderr: "" }],
    ]);
    const host = new GitHubGhPullRequestHost({
      runner,
      repoRoot: "/repo",
      pushRemote: "publish",
    });
    await assert.rejects(
      host.getPullRequest({ targetRepository: target, number: 42 }),
      (error: unknown) => {
        if (code === 0)
          assert.ok(error instanceof GitHubPullRequestResponseError);
        else {
          assert.ok(error instanceof GitHubPullRequestCommandError);
          assert.equal(
            error.reason,
            code === 4 ? "authentication-required" : "command-failed",
          );
        }
        assert.ok(!(error instanceof PullRequestNotFoundError));
        return true;
      },
    );
  }
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
