import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandResult } from "../cli/commands/triage/types.ts";
import { createStaticCommandRunner } from "../../test-support/command-runner.ts";
import { ForgejoTeaPullRequestError } from "./forgejo-tea-pull-request-errors.ts";
import { PullRequestIdentityError } from "./pull-requests.ts";
import { ForgejoTeaPullRequestHost } from "./forgejo-tea-pull-requests.ts";

function repositoryPayload({
  host = "forge.example",
  owner,
  repository,
}: {
  host?: string;
  owner: string;
  repository: string;
}): Record<string, unknown> {
  return {
    name: repository,
    full_name: `${owner}/${repository}`,
    owner: { login: owner },
    html_url: `https://${host}/${owner}/${repository}`,
  };
}
function jsonResult(value: unknown, stderr = ""): CommandResult {
  return { code: 0, stdout: JSON.stringify(value), stderr };
}
async function withForgejoRepository(
  run: (repoRoot: string) => Promise<void>,
): Promise<void> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-forgejo-"));
  try {
    await mkdir(join(repoRoot, ".git"));
    await writeFile(
      join(repoRoot, ".git", "config"),
      '[remote "origin"]\n    url = git@forge.example:legacy/widgets.git\n',
    );
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}
const target = {
  provider: "forgejo-tea" as const,
  host: "forge.example",
  owner: "platform",
  repository: "widgets",
};
const head = {
  provider: "forgejo-tea" as const,
  host: "forge.example",
  owner: "contributor",
  repository: "widgets",
};
function pull(number = 42, overrides: Record<string, unknown> = {}) {
  return {
    number,
    html_url: `https://forge.example/platform/widgets/pulls/${number}`,
    body: "body",
    state: "open",
    merged: false,
    merge_commit_sha: null,
    base: { ref: "main", repo: repositoryPayload(target) },
    head: { ref: "topic", sha: "abc", repo: repositoryPayload(head) },
    ...overrides,
  };
}

test("resolves target and each configured push URL with exact safe commands", async () =>
  withForgejoRepository(async (repoRoot) => {
    const runner = createStaticCommandRunner([
      jsonResult(repositoryPayload(target)),
      {
        code: 0,
        stdout:
          "git@forge.example:contributor/widgets.git\nhttps://forge.example/contributor/widgets.git\n",
        stderr: "",
      },
      jsonResult(repositoryPayload(head)),
      jsonResult(repositoryPayload(head)),
    ]);
    const host = new ForgejoTeaPullRequestHost({
      runner,
      repoRoot,
      pushRemote: "-publish",
      login: "robot",
    });
    assert.deepEqual(await host.resolveTargetRepositoryIdentity(), target);
    assert.deepEqual(
      await host.resolveRemoteRepositoryIdentity("-publish"),
      head,
    );
    assert.deepEqual(runner.calls, [
      {
        command: "tea",
        args: [
          "api",
          "/repos/{owner}/{repo}",
          "--include",
          "--repo",
          "legacy/widgets",
          "--login",
          "robot",
        ],
        cwd: repoRoot,
      },
      {
        command: "git",
        args: ["remote", "get-url", "--push", "--all", "--", "-publish"],
        cwd: repoRoot,
      },
      {
        command: "tea",
        args: [
          "api",
          "/repos/{owner}/{repo}",
          "--include",
          "--repo",
          "contributor/widgets",
          "--login",
          "robot",
        ],
        cwd: repoRoot,
      },
      {
        command: "tea",
        args: [
          "api",
          "/repos/{owner}/{repo}",
          "--include",
          "--repo",
          "contributor/widgets",
          "--login",
          "robot",
        ],
        cwd: repoRoot,
      },
    ]);
  }));

test("create, find, get, read, and update use exhaustive validated API operations", async () =>
  withForgejoRepository(async (repoRoot) => {
    const full = Array.from({ length: 50 }, (_, i) => pull(i + 1));
    const runner = createStaticCommandRunner([
      jsonResult(repositoryPayload(target)),
      {
        code: 0,
        stdout: "git@forge.example:contributor/widgets.git\n",
        stderr: "",
      },
      jsonResult(repositoryPayload(head)),
      jsonResult(pull()),
      jsonResult(repositoryPayload(target)),
      {
        code: 0,
        stdout: "git@forge.example:contributor/widgets.git\n",
        stderr: "",
      },
      jsonResult(repositoryPayload(head)),
      jsonResult(full),
      jsonResult([]),
      jsonResult(repositoryPayload(target)),
      {
        code: 0,
        stdout: "git@forge.example:contributor/widgets.git\n",
        stderr: "",
      },
      jsonResult(repositoryPayload(head)),
      jsonResult(pull()),
      jsonResult(repositoryPayload(target)),
      {
        code: 0,
        stdout: "git@forge.example:contributor/widgets.git\n",
        stderr: "",
      },
      jsonResult(repositoryPayload(head)),
      jsonResult(pull()),
      jsonResult(repositoryPayload(target)),
      {
        code: 0,
        stdout: "git@forge.example:contributor/widgets.git\n",
        stderr: "",
      },
      jsonResult(repositoryPayload(head)),
      jsonResult(pull()),
      jsonResult({}),
    ]);
    const host = new ForgejoTeaPullRequestHost({
      runner,
      repoRoot,
      pushRemote: "publish",
      login: "robot",
    });
    const created = await host.createPullRequest({
      title: "Plan",
      body: "Details",
      baseBranch: "main",
      headBranch: "topic",
    });
    assert.equal(created.number, 42);
    const query = {
      targetRepository: target,
      baseBranch: "main",
      headRepository: head,
      headBranch: "topic",
    };
    assert.equal((await host.findPullRequests(query)).length, 50);
    const reference = { targetRepository: target, number: 42 };
    assert.equal((await host.getPullRequest(reference)).number, 42);
    assert.equal(await host.readPullRequestBody(reference), "body");
    await host.updatePullRequestBody(reference, "Summary\n\nDetails\n");
    assert.deepEqual(runner.calls[3], {
      command: "tea",
      args: [
        "api",
        "/repos/{owner}/{repo}/pulls",
        "--method",
        "POST",
        "--field",
        "base=main",
        "--field",
        "head=contributor:topic",
        "--field",
        "title=Plan",
        "--field",
        "body=Details",
        "--include",
        "--repo",
        "legacy/widgets",
        "--login",
        "robot",
      ],
      cwd: repoRoot,
    });
    assert.deepEqual(runner.calls[7], {
      command: "tea",
      args: [
        "api",
        "/repos/{owner}/{repo}/pulls?state=all&page=1&limit=50",
        "--include",
        "--repo",
        "legacy/widgets",
        "--login",
        "robot",
      ],
      cwd: repoRoot,
    });
    assert.deepEqual(runner.calls.at(-1), {
      command: "tea",
      args: [
        "api",
        "/repos/{owner}/{repo}/pulls/42",
        "--method",
        "PATCH",
        "--field",
        "body=Summary\n\nDetails\n",
        "--include",
        "--repo",
        "legacy/widgets",
        "--login",
        "robot",
      ],
      cwd: repoRoot,
    });
  }));

test("only a nonzero exact get 404 is not found", async () =>
  withForgejoRepository(async (repoRoot) => {
    const runner = createStaticCommandRunner([
      jsonResult(repositoryPayload(target)),
      {
        code: 0,
        stdout: "git@forge.example:contributor/widgets.git\n",
        stderr: "",
      },
      jsonResult(repositoryPayload(head)),
      { code: 1, stdout: "", stderr: "HTTP/2 404 Not Found\n" },
    ]);
    const host = new ForgejoTeaPullRequestHost({
      runner,
      repoRoot,
      pushRemote: "publish",
    });
    await assert.rejects(
      host.getPullRequest({ targetRepository: target, number: 42 }),
      { name: "PullRequestNotFoundError" },
    );
  }));

test("command failures retain safe status diagnostics", async () =>
  withForgejoRepository(async (repoRoot) => {
    const runner = createStaticCommandRunner([
      {
        code: 1,
        stdout: "secret",
        stderr: "HTTP/1.1 302 Found\nHTTP/2 403 Forbidden\n",
      },
    ]);
    const host = new ForgejoTeaPullRequestHost({
      runner,
      repoRoot,
      pushRemote: "publish",
    });
    await assert.rejects(
      host.resolveTargetRepositoryIdentity(),
      (error: unknown) => {
        assert.ok(error instanceof ForgejoTeaPullRequestError);
        assert.equal(error.httpStatus, 403);
        assert.equal(error.rawDiagnostics?.stdout, "secret");
        assert.ok(!JSON.stringify(error).includes("secret"));
        return true;
      },
    );
  }));

test("invalid JSON does not retain a secret-bearing parser cause", async () =>
  withForgejoRepository(async (repoRoot) => {
    const secret = "credential-that-must-not-leak";
    const host = hostFor(repoRoot, [
      { code: 0, stdout: `{"token":"${secret}"`, stderr: "" },
    ]);
    await assert.rejects(
      host.resolveTargetRepositoryIdentity(),
      (error: unknown) => {
        assert.ok(error instanceof ForgejoTeaPullRequestError);
        assert.equal(error.category, "invalid-json");
        assert.equal(error.cause, undefined);
        assert.ok(!error.message.includes(secret));
        assert.ok(!JSON.stringify(error).includes(secret));
        return true;
      },
    );
  }));

test("a contradictory successful 404 remains a command failure", async () =>
  withForgejoRepository(async (repoRoot) => {
    const runner = createStaticCommandRunner([
      jsonResult(repositoryPayload(target)),
      {
        code: 0,
        stdout: "git@forge.example:contributor/widgets.git\n",
        stderr: "",
      },
      jsonResult(repositoryPayload(head)),
      { code: 0, stdout: "{}", stderr: "HTTP/2 404 Not Found\n" },
    ]);
    const host = new ForgejoTeaPullRequestHost({
      runner,
      repoRoot,
      pushRemote: "publish",
    });
    await assert.rejects(
      host.getPullRequest({ targetRepository: target, number: 42 }),
      ForgejoTeaPullRequestError,
    );
  }));

function contextResults(): CommandResult[] {
  return [
    jsonResult(repositoryPayload(target)),
    {
      code: 0,
      stdout: "git@forge.example:contributor/widgets.git\n",
      stderr: "",
    },
    jsonResult(repositoryPayload(head)),
  ];
}
function query() {
  return {
    targetRepository: target,
    baseBranch: "main",
    headRepository: head,
    headBranch: "topic",
  };
}
function hostFor(repoRoot: string, results: CommandResult[]) {
  return new ForgejoTeaPullRequestHost({
    runner: createStaticCommandRunner(results),
    repoRoot,
    pushRemote: "publish",
    login: "robot",
  });
}

test("repository commands retain complete HTTP status diagnostics", async () =>
  withForgejoRepository(async (repoRoot) => {
    for (const { stderr, expectedStatus } of [
      { stderr: "HTTP/2 401 Unauthorized\n", expectedStatus: 401 },
      { stderr: "HTTP/1.1 429 Too Many Requests\n", expectedStatus: 429 },
      {
        stderr: "request failed with 404 in diagnostic text",
        expectedStatus: undefined,
      },
      {
        stderr: "HTTP/1.1 302 Found\nlocation: /next\n\nHTTP/2 403 Forbidden\n",
        expectedStatus: 403,
      },
    ]) {
      const host = hostFor(repoRoot, [{ code: 1, stdout: "secret", stderr }]);
      await assert.rejects(
        host.resolveTargetRepositoryIdentity(),
        (error: unknown) => {
          assert.ok(error instanceof ForgejoTeaPullRequestError);
          assert.equal(error.category, "command-failed");
          assert.equal(error.operation, "resolve-target-repository");
          assert.equal(error.exitCode, 1);
          assert.equal(error.httpStatus, expectedStatus);
          assert.equal(error.rawDiagnostics?.stdout, "secret");
          assert.equal(Object.keys(error).includes("rawDiagnostics"), false);
          return true;
        },
      );
    }
  }));

test("remote resolution rejects failed, empty, malformed, and disagreeing remotes", async () =>
  withForgejoRepository(async (repoRoot) => {
    const cases = [
      {
        results: [{ code: 1, stdout: "", stderr: "failed" }],
        error: ForgejoTeaPullRequestError,
      },
      {
        results: [{ code: 0, stdout: "\n\r\n", stderr: "" }],
        error: ForgejoTeaPullRequestError,
      },
      {
        results: [
          {
            code: 0,
            stdout: "git@forge.example:/contributor/widgets.git\n",
            stderr: "",
          },
        ],
        error: PullRequestIdentityError,
      },
      {
        results: [
          {
            code: 0,
            stdout: "git@forge.example:contributor/widgets.git\n",
            stderr: "",
          },
          jsonResult(repositoryPayload({ ...head, host: "other.example" })),
        ],
        error: PullRequestIdentityError,
      },
      {
        results: [
          {
            code: 0,
            stdout:
              "git@forge.example:contributor/widgets.git\ngit@forge.example:other/widgets.git\n",
            stderr: "",
          },
          jsonResult(repositoryPayload(head)),
          jsonResult(repositoryPayload({ ...head, owner: "other" })),
        ],
        error: PullRequestIdentityError,
      },
    ];
    for (const { results, error } of cases) {
      const host = hostFor(repoRoot, results);
      await assert.rejects(
        host.resolveRemoteRepositoryIdentity("publish"),
        error,
      );
    }
  }));

test("input validation prevents any live command", async () =>
  withForgejoRepository(async (repoRoot) => {
    const runner = createStaticCommandRunner([]);
    assert.throws(
      () =>
        new ForgejoTeaPullRequestHost({
          runner,
          repoRoot,
          pushRemote: " ",
        }),
      ForgejoTeaPullRequestError,
    );
    const host = new ForgejoTeaPullRequestHost({
      runner,
      repoRoot,
      pushRemote: "publish",
    });
    await assert.rejects(
      host.createPullRequest({
        title: "title",
        body: "body",
        baseBranch: "main",
        headBranch: "topic\u007fnext",
      }),
      ForgejoTeaPullRequestError,
    );
    await assert.rejects(
      host.getPullRequest({ targetRepository: target, number: 0 }),
      ForgejoTeaPullRequestError,
    );
    assert.deepEqual(runner.calls, []);
  }));

test("find fetches page two before filtering and never returns a partial result", async () =>
  withForgejoRepository(async (repoRoot) => {
    const fullPage = Array.from({ length: 50 }, (_, index) => pull(index + 1));
    const runner = createStaticCommandRunner([
      ...contextResults(),
      jsonResult(fullPage),
      { code: 1, stdout: "", stderr: "HTTP/2 500 Server Error\n" },
    ]);
    const host = new ForgejoTeaPullRequestHost({
      runner,
      repoRoot,
      pushRemote: "publish",
      login: "robot",
    });
    await assert.rejects(host.findPullRequests(query()), (error: unknown) => {
      assert.ok(error instanceof ForgejoTeaPullRequestError);
      assert.equal(error.operation, "list-pull-requests");
      return true;
    });
    assert.deepEqual(runner.calls[4], {
      command: "tea",
      args: [
        "api",
        "/repos/{owner}/{repo}/pulls?state=all&page=2&limit=50",
        "--include",
        "--repo",
        "legacy/widgets",
        "--login",
        "robot",
      ],
      cwd: repoRoot,
    });
  }));

test("find stops on a short raw page and excludes nonmatching heads", async () =>
  withForgejoRepository(async (repoRoot) => {
    const unrelatedHead = {
      provider: "forgejo-tea" as const,
      host: "forge.example",
      owner: "other",
      repository: "widgets",
    };
    const runner = createStaticCommandRunner([
      ...contextResults(),
      jsonResult([
        pull(1),
        pull(2, {
          head: {
            ref: "topic",
            sha: "abc",
            repo: repositoryPayload(unrelatedHead),
          },
        }),
      ]),
    ]);
    const host = new ForgejoTeaPullRequestHost({
      runner,
      repoRoot,
      pushRemote: "publish",
    });
    assert.deepEqual(
      (await host.findPullRequests(query())).map((entry) => entry.number),
      [1],
    );
    assert.equal(runner.calls.length, 4);
  }));

test("get status classification, malformed payloads, and failed validation suppress PATCH", async () =>
  withForgejoRepository(async (repoRoot) => {
    const reference = { targetRepository: target, number: 42 };
    const statusCases = [
      { code: 1, stderr: "request failed with 404 in diagnostic text\n" },
      { code: 1, stderr: "HTTP/2 401 Unauthorized\n" },
      { code: 1, stderr: "HTTP/1.1 429 Too Many Requests\n" },
      { code: 1, stderr: "HTTP/2 500 Server Error\n" },
      { code: 0, stderr: "HTTP/2 404 Not Found\n" },
    ];
    for (const result of statusCases) {
      const host = hostFor(repoRoot, [
        ...contextResults(),
        { stdout: "{}", ...result },
      ]);
      await assert.rejects(
        host.getPullRequest(reference),
        ForgejoTeaPullRequestError,
      );
    }
    for (const result of [
      { code: 0, stdout: "not json", stderr: "" },
      { code: 0, stdout: "{}", stderr: "" },
    ]) {
      const host = hostFor(repoRoot, [...contextResults(), result]);
      await assert.rejects(
        host.getPullRequest(reference),
        ForgejoTeaPullRequestError,
      );
    }
    const runner = createStaticCommandRunner([
      ...contextResults(),
      { code: 1, stdout: "", stderr: "HTTP/2 403 Forbidden\n" },
    ]);
    const host = new ForgejoTeaPullRequestHost({
      runner,
      repoRoot,
      pushRemote: "publish",
    });
    await assert.rejects(
      host.updatePullRequestBody(reference, "Summary\n\nDetails\n"),
      ForgejoTeaPullRequestError,
    );
    assert.equal(
      runner.calls.some((call) => call.args.includes("PATCH")),
      false,
    );
  }));

test("the final HTTP status controls exact get classification", async () =>
  withForgejoRepository(async (repoRoot) => {
    const reference = { targetRepository: target, number: 42 };
    const notFound = hostFor(repoRoot, [
      ...contextResults(),
      {
        code: 1,
        stdout: "",
        stderr: "HTTP/1.1 302 Found\nlocation: /next\n\nHTTP/2 404 Not Found\n",
      },
    ]);
    await assert.rejects(notFound.getPullRequest(reference), {
      name: "PullRequestNotFoundError",
    });
    const found = hostFor(repoRoot, [
      ...contextResults(),
      jsonResult(pull(), "HTTP/2 404 Not Found\nHTTP/2 200 OK\n"),
    ]);
    assert.equal((await found.getPullRequest(reference)).number, 42);
  }));

test("find rejects malformed later list results without exposing partial matches", async () =>
  withForgejoRepository(async (repoRoot) => {
    for (const result of [
      { code: 0, stdout: "not json", stderr: "" },
      jsonResult({}),
      jsonResult([pull(1, { head: { ref: "topic" } })]),
    ]) {
      const host = hostFor(repoRoot, [...contextResults(), result]);
      await assert.rejects(
        host.findPullRequests(query()),
        ForgejoTeaPullRequestError,
      );
    }
  }));

test("find validates live query identities before issuing a list request", async () =>
  withForgejoRepository(async (repoRoot) => {
    const runner = createStaticCommandRunner(contextResults());
    const host = new ForgejoTeaPullRequestHost({
      runner,
      repoRoot,
      pushRemote: "publish",
    });
    await assert.rejects(
      host.findPullRequests({ ...query(), targetRepository: head }),
      PullRequestIdentityError,
    );
    assert.equal(runner.calls.length, 3);
  }));

test("get validates caller and response identities before accepting a payload", async () =>
  withForgejoRepository(async (repoRoot) => {
    const reference = { targetRepository: target, number: 42 };
    const callerMismatchRunner = createStaticCommandRunner(contextResults());
    const callerMismatch = new ForgejoTeaPullRequestHost({
      runner: callerMismatchRunner,
      repoRoot,
      pushRemote: "publish",
    });
    await assert.rejects(
      callerMismatch.getPullRequest({ targetRepository: head, number: 42 }),
      PullRequestIdentityError,
    );
    assert.equal(callerMismatchRunner.calls.length, 3);

    for (const payload of [
      pull(41),
      pull(42, {
        html_url: "https://forge.example/platform/widgets/issues/42",
      }),
      pull(42, { base: { ref: "main" } }),
      pull(42, {
        head: { ref: "topic", sha: "abc", repo: repositoryPayload(target) },
      }),
    ]) {
      const host = hostFor(repoRoot, [
        ...contextResults(),
        jsonResult(payload),
      ]);
      await assert.rejects(host.getPullRequest(reference));
    }
  }));

test("a PATCH 404 remains a command failure after a validated get", async () =>
  withForgejoRepository(async (repoRoot) => {
    const runner = createStaticCommandRunner([
      ...contextResults(),
      jsonResult(pull()),
      { code: 1, stdout: "", stderr: "HTTP/2 404 Not Found\n" },
    ]);
    const host = new ForgejoTeaPullRequestHost({
      runner,
      repoRoot,
      pushRemote: "publish",
    });
    await assert.rejects(
      host.updatePullRequestBody(
        { targetRepository: target, number: 42 },
        "Summary\n\nDetails\n",
      ),
      ForgejoTeaPullRequestError,
    );
    assert.equal(runner.calls.at(-1)?.args.includes("PATCH"), true);
  }));
