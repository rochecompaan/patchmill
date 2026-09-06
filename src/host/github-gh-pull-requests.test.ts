import assert from "node:assert/strict";
import test from "node:test";
import type { CommandResult } from "../process/command.ts";
import {
  PullRequestIdentityError,
  PullRequestNotFoundError,
} from "./pull-requests.ts";
import {
  GitHubPullRequestCommandError,
  GitHubPullRequestInputError,
} from "./github-gh-pull-request-errors.ts";
import { GitHubGhPullRequestHost } from "./github-gh-pull-requests.ts";
import {
  existence,
  fields,
  gql,
  key,
  ok,
  payload,
  remote,
  remoteRepo,
  repository,
  Runner,
  setup,
  target,
  targetPayload,
  view,
} from "../../test-support/github-gh-pull-request.ts";

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

test("rejects one mismatched destination among multiple push URLs", async () => {
  const otherRemote = [
    "repo",
    "view",
    "github.com/other/project",
    "--json",
    "nameWithOwner,url",
  ];
  const other = {
    nameWithOwner: "other/project",
    url: "https://github.com/other/project",
  };
  const runner = new Runner(
    new Map([
      [
        key("git", remote),
        [
          ok(
            "git@github.com:acme/project.git\n" +
              "https://github.com/other/project.git\n",
          ),
        ],
      ],
      [key("gh", remoteRepo), [ok(targetPayload)]],
      [key("gh", otherRemote), [ok(JSON.stringify(other))]],
    ]),
  );
  await assert.rejects(
    new GitHubGhPullRequestHost({
      runner,
      repoRoot: "/repo",
      pushRemote: "publish",
    }).resolveRemoteRepositoryIdentity("publish"),
    (error: unknown) => {
      assert.ok(error instanceof PullRequestIdentityError);
      assert.deepEqual(error.expected, target);
      assert.deepEqual(error.actual, { ...target, owner: "other" });
      return true;
    },
  );
});

test("waits for each multi-push provider lookup before starting the next", async () => {
  const first = Promise.withResolvers<CommandResult>();
  const runner = new Runner(
    new Map([
      [
        key("git", remote),
        [
          ok(
            "git@github.com:acme/project.git\nhttps://github.com/acme/project.git\n",
          ),
        ],
      ],
      [key("gh", remoteRepo), [first.promise, ok(targetPayload)]],
    ]),
  );
  const pending = new GitHubGhPullRequestHost({
    runner,
    repoRoot: "/repo",
    pushRemote: "publish",
  }).resolveRemoteRepositoryIdentity("publish");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    runner.calls.filter(
      (call) => key(call.command, call.args) === key("gh", remoteRepo),
    ).length,
    1,
  );
  first.resolve(ok(targetPayload));
  await pending;
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

test("preserves rate-limit and transport probe failures as command errors", async () => {
  for (const code of [2, 75]) {
    const runner = setup([
      ["gh", existence, { code, stdout: "diagnostic", stderr: "diagnostic" }],
    ]);
    await assert.rejects(
      new GitHubGhPullRequestHost({
        runner,
        repoRoot: "/repo",
        pushRemote: "publish",
      }).getPullRequest({ targetRepository: target, number: 42 }),
      (error: unknown) => {
        assert.ok(error instanceof GitHubPullRequestCommandError);
        assert.equal(error.reason, "command-failed");
        assert.equal(error.operation, "probe-pull-request");
        assert.equal(error.exitCode, code);
        assert.equal(
          Object.prototype.propertyIsEnumerable.call(error, "diagnostics"),
          false,
        );
        return true;
      },
    );
  }
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
test("rejects push, query, and reference identities before discovery or view", async () => {
  const other = { ...target, owner: "other" };
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
  const pushRunner = setup(
    [],
    undefined,
    JSON.stringify({
      nameWithOwner: "other/project",
      url: "https://github.com/other/project",
    }),
  );
  await assert.rejects(
    new GitHubGhPullRequestHost({
      runner: pushRunner,
      repoRoot: "/repo",
      pushRemote: "publish",
    }).findPullRequests({
      targetRepository: target,
      baseBranch: "main",
      headRepository: target,
      headBranch: "agent/change",
    }),
    PullRequestIdentityError,
  );
  assert.equal(
    pushRunner.calls.some(
      (call) => key(call.command, call.args) === key("gh", list),
    ),
    false,
  );
  for (const operation of ["query", "reference"] as const) {
    const runner = setup();
    const host = new GitHubGhPullRequestHost({
      runner,
      repoRoot: "/repo",
      pushRemote: "publish",
    });
    if (operation === "query")
      await assert.rejects(
        host.findPullRequests({
          targetRepository: other,
          baseBranch: "main",
          headRepository: target,
          headBranch: "agent/change",
        }),
        PullRequestIdentityError,
      );
    else
      await assert.rejects(
        host.getPullRequest({ targetRepository: other, number: 42 }),
        PullRequestIdentityError,
      );
    assert.equal(
      runner.calls.some(
        (call) => call.args[0] === "api" || call.args[1] === "list",
      ),
      false,
    );
  }
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
