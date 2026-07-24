import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import {
  readForgejoPullRequestBody,
  updateForgejoPullRequestBody,
} from "./forgejo-pr-body.ts";
import type { CommandRunner } from "../cli/commands/triage/types.ts";

async function withRepo(
  fn: (repoRoot: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "patchmill-forgejo-pr-body-"));
  try {
    await mkdir(join(root, ".git"));
    await writeFile(
      join(root, ".git", "config"),
      '[remote "origin"]\n\turl = git@git.example:acme/repo.git\n',
    );
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Forgejo PR body adapter validates returned repository URLs", async () => {
  await withRepo(async (repoRoot) => {
    const runner: CommandRunner = {
      async run() {
        return {
          code: 0,
          stdout: JSON.stringify({
            body: "Summary",
            html_url: "https://git.example/other/repo/pulls/42",
          }),
          stderr: "",
        };
      },
    };

    await assert.rejects(
      () =>
        readForgejoPullRequestBody(
          { runner, repoRoot, login: "robot" },
          "https://git.example/acme/repo/pulls/42",
        ),
      /mismatched PR body/u,
    );
  });
});

test("Forgejo PR body adapter passes the description as one multiline argument", async () => {
  await withRepo(async (repoRoot) => {
    const calls: string[][] = [];
    const runner: CommandRunner = {
      async run(command, args) {
        assert.equal(command, "tea");
        calls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
    };

    await updateForgejoPullRequestBody(
      { runner, repoRoot, login: "robot" },
      "https://git.example/acme/repo/pulls/42",
      "Summary\n\nDetails\n",
    );

    assert.deepEqual(calls, [
      [
        "pulls",
        "edit",
        "42",
        "--description",
        "Summary\n\nDetails\n",
        "--repo",
        "acme/repo",
        "--login",
        "robot",
      ],
    ]);
  });
});
