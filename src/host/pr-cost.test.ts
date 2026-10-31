import assert from "node:assert/strict";
import { test } from "node:test";
import { recordingRunner } from "../../test-support/recording-runner.ts";
import { CommandFailedError } from "../process/command.ts";
import { GitHubHost } from "./github-gh.ts";
import { ForgejoHost } from "./forgejo-tea.ts";

const body = "Description with 'quotes' and $shell\n\nCloses #9\n";

test("GitHub PR body updates use stdin in the configured repository", async () => {
  const runner = recordingRunner([{ match: /gh pr edit/, result: {} }]);
  await new GitHubHost({ runner, repoRoot: "/repo" }).updatePullRequestBody(
    14,
    body,
  );
  assert.deepEqual(runner.calls, [
    ["gh", "pr", "edit", "14", "--body-file", "-"],
  ]);
  assert.deepEqual(runner.options, [{ cwd: "/repo", stdin: body }]);
});

for (const login of ["selected", ""]) {
  test(`Forgejo PR body update patches only the body with login ${JSON.stringify(login)}`, async () => {
    const runner = recordingRunner([
      { match: /^git /, result: { stdout: "git@host:owner/repo.git" } },
      { match: /^tea api/, result: {} },
    ]);
    await new ForgejoHost({
      runner,
      repoRoot: "/repo",
      login,
    }).updatePullRequestBody(14, body);
    assert.deepEqual(runner.calls, [
      ["git", "remote", "get-url", "origin"],
      [
        "tea",
        "api",
        "/repos/{owner}/{repo}/pulls/14",
        "--method",
        "PATCH",
        "--field",
        `body=${body}`,
        "--repo",
        "owner/repo",
        ...(login ? ["--login", "selected"] : []),
      ],
    ]);
    assert.ok(runner.options.every((options) => options?.cwd === "/repo"));
  });
}

for (const provider of ["github", "forgejo"]) {
  test(`${provider} PR body update exposes host errors to the non-blocking reporting boundary`, async () => {
    const runner = recordingRunner([
      { match: /^git /, result: { stdout: "git@host:owner/repo.git" } },
      { match: /^(gh|tea) /, result: { code: 1, stderr: "permission denied" } },
    ]);
    const host =
      provider === "github"
        ? new GitHubHost({ runner, repoRoot: "/repo" })
        : new ForgejoHost({ runner, repoRoot: "/repo", login: "selected" });
    await assert.rejects(host.updatePullRequestBody(14, body), (error) => {
      assert.ok(error instanceof CommandFailedError);
      assert.match(error.message, /permission denied/);
      return true;
    });
  });
}
