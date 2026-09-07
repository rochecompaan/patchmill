import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandResult } from "../cli/commands/triage/types.ts";
import { createStaticCommandRunner } from "../../test-support/command-runner.ts";
import { ForgejoTeaPullRequestError } from "./forgejo-tea-pull-request-errors.ts";
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
