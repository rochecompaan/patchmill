import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  readGitHubPullRequestBody,
  updateGitHubPullRequestBody,
} from "./github-pr-body.ts";
import type { CommandRunner } from "../cli/commands/triage/types.ts";

test("GitHub PR body adapter rejects a body returned for another repository", async () => {
  const runner: CommandRunner = {
    async run() {
      return {
        code: 0,
        stdout: JSON.stringify({
          body: "Summary",
          url: "https://github.com/other/repo/pull/42",
        }),
        stderr: "",
      };
    },
  };

  await assert.rejects(
    () =>
      readGitHubPullRequestBody(
        { runner, repoRoot: "/repo" },
        "https://github.com/acme/repo/pull/42",
      ),
    /mismatched PR body/u,
  );
});

test("GitHub PR body adapter removes its temporary body file after an edit failure", async () => {
  let bodyPath = "";
  const runner: CommandRunner = {
    async run(_, args) {
      bodyPath = args[4]!;
      return { code: 1, stdout: "", stderr: "permission denied" };
    },
  };

  await assert.rejects(
    () =>
      updateGitHubPullRequestBody(
        { runner, repoRoot: "/repo" },
        "https://github.com/acme/repo/pull/42",
        "Summary\n",
      ),
    /gh pr edit failed: permission denied/u,
  );
  await assert.rejects(() => access(bodyPath));
});

test("GitHub PR body adapter writes multiline bodies through a cleaned temporary file", async () => {
  let bodyPath = "";
  const runner: CommandRunner = {
    async run(command, args) {
      assert.equal(command, "gh");
      assert.deepEqual(args.slice(0, 4), ["pr", "edit", "42", "--body-file"]);
      bodyPath = args[4]!;
      assert.equal(await readFile(bodyPath, "utf8"), "Summary\n\nDetails\n");
      return { code: 0, stdout: "", stderr: "" };
    },
  };

  await updateGitHubPullRequestBody(
    { runner, repoRoot: "/repo" },
    "https://github.com/acme/repo/pull/42",
    "Summary\n\nDetails\n",
  );

  await assert.rejects(() => access(bodyPath));
});
