import assert from "node:assert/strict";
import test from "node:test";
import type { CommandResult } from "../process/command.ts";
import {
  IncompletePullRequestSearchError,
  PullRequestIdentityError,
  PullRequestNotFoundError,
} from "./pull-requests.ts";
import {
  GitHubPullRequestCommandError,
  GitHubPullRequestJsonError,
  GitHubPullRequestResponseError,
} from "./github-gh-pull-request-errors.ts";
import { GitHubGhPullRequestHost } from "./github-gh-pull-requests.ts";
import {
  existence,
  fields,
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

test("derives the create head operand from the resolved owner for branch at", async () => {
  const create = [
    "pr",
    "create",
    "--repo",
    "github.com/acme/project",
    "--base",
    "main",
    "--head",
    "acme:@",
    "--title",
    "title",
    "--body",
    "body",
  ];
  const runner = setup([["gh", create, ok("")]]);
  await assert.rejects(
    new GitHubGhPullRequestHost({
      runner,
      repoRoot: "/repo",
      pushRemote: "publish",
    }).createPullRequest({
      title: "title",
      body: "body",
      baseBranch: "main",
      headBranch: "@",
    }),
    GitHubPullRequestResponseError,
  );
  assert.ok(
    runner.calls.some(
      (call) => key(call.command, call.args) === key("gh", create),
    ),
  );
});

test("fails closed for empty and multiple create-command URLs with stable response codes", async () => {
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
  for (const output of [
    "",
    "https://github.com/acme/project/pull/42 https://github.com/acme/project/pull/43",
  ]) {
    await assert.rejects(
      new GitHubGhPullRequestHost({
        runner: setup([["gh", create, ok(output)]]),
        repoRoot: "/repo",
        pushRemote: "publish",
      }).createPullRequest({
        title: "title",
        body: "body",
        baseBranch: "main",
        headBranch: "agent/change",
      }),
      (error: unknown) => {
        assert.ok(error instanceof GitHubPullRequestResponseError);
        assert.equal(error.code, "github-pull-request-malformed-response");
        return true;
      },
    );
  }
});

test("normalizes all provider states during adapter discovery and rejects a mismatched query head", async () => {
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
    "4",
    "--json",
    fields,
  ];
  const entry = JSON.parse(payload) as Record<string, unknown>;
  const runner = setup([
    [
      "gh",
      list,
      ok(
        JSON.stringify([
          entry,
          { ...entry, state: "MERGED", mergeCommit: { oid: "merge" } },
          { ...entry, state: "CLOSED" },
        ]),
      ),
    ],
  ]);
  const host = new GitHubGhPullRequestHost({
    runner,
    repoRoot: "/repo",
    pushRemote: "publish",
    discoveryLimit: 4,
  });
  assert.deepEqual(
    (
      await host.findPullRequests({
        targetRepository: target,
        baseBranch: "main",
        headRepository: target,
        headBranch: "agent/change",
      })
    ).map((result) => result.status),
    ["open", "merged", "closed-unmerged"],
  );
  const mismatchRunner = setup();
  await assert.rejects(
    new GitHubGhPullRequestHost({
      runner: mismatchRunner,
      repoRoot: "/repo",
      pushRemote: "publish",
    }).findPullRequests({
      targetRepository: target,
      baseBranch: "main",
      headRepository: { ...target, owner: "other" },
      headBranch: "agent/change",
    }),
    PullRequestIdentityError,
  );
  assert.equal(
    mismatchRunner.calls.some((call) => call.args[1] === "list"),
    false,
  );
});

test("keeps command errors non-disclosing and exposes stable error codes", async () => {
  const sensitiveBody = "sensitive pull request body";
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
    sensitiveBody,
  ];
  await assert.rejects(
    new GitHubGhPullRequestHost({
      runner: setup([
        ["gh", create, { code: 2, stdout: sensitiveBody, stderr: "" }],
      ]),
      repoRoot: "/repo",
      pushRemote: "publish",
    }).createPullRequest({
      title: "title",
      body: sensitiveBody,
      baseBranch: "main",
      headBranch: "agent/change",
    }),
    (error: unknown) => {
      assert.ok(error instanceof GitHubPullRequestCommandError);
      assert.equal(error.code, "github-pull-request-command-failed");
      assert.equal(error.operation, "create-pull-request");
      assert.doesNotMatch(
        `${error.message}\n${JSON.stringify(error)}`,
        /sensitive pull request body/u,
      );
      assert.equal(
        Object.prototype.propertyIsEnumerable.call(error, "diagnostics"),
        false,
      );
      assert.match(error.diagnostics.stdout, /sensitive pull request body/u);
      return true;
    },
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
