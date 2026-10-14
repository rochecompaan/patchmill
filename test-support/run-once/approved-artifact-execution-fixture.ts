import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { TestContext } from "node:test";
import { createCommandRunner } from "../../src/cli/commands/triage/command.ts";
import { runLegacyOneIssue } from "../../src/cli/commands/run-once/pipeline-legacy.ts";
import { buildIssueBranchName } from "../../src/git/worktree-strategy.ts";
import { formatPublishedArtifactComment } from "../../src/workflow/artifacts/published-artifacts.ts";
import { issue, issueListPayload, labelListPayload } from "./issue-fixtures.ts";
import {
  normalizeRecordedPiCall,
  promptPath,
  type Call,
} from "./mock-runner.ts";
import { approvalPolicy, makeConfig } from "./pipeline-fixtures.ts";
import { writeFixtureRunState } from "./run-state-fixture.ts";

const now = new Date("2026-10-14T12:00:00Z");
export async function approvedArtifactExecutionFixture(
  t: TestContext,
  options: {
    source?: "repository" | "published" | "branch";
    configuredDirectory?: boolean;
    afterWorktree?: (path: string) => Promise<void>;
    afterMaterialization?: (path: string) => Promise<void>;
  } = {},
) {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    issueNumber: 140,
    approvalPolicy: approvalPolicy({ specRequired: false, planRequired: true }),
  });
  t.after(() => rm(config.repoRoot, { recursive: true, force: true }));
  if (options.configuredDirectory)
    config.plansDir = join(config.repoRoot, "design notes", "approved plans");
  const path = `${options.configuredDirectory ? "design notes/approved plans" : "docs/plans"}/2026-10-14-issue-140-keep-approved-artifacts.md`;
  const content = "# Approved plan\nUse the retained selection.\n";
  const selected = issue(
    140,
    ["in-progress", "plan-approved"],
    "Keep approved artifacts",
  );
  const branch = buildIssueBranchName(selected.number, selected.title);
  const actual = createCommandRunner();
  const git = async (...args: string[]) => {
    const result = await actual.run("git", args, { cwd: config.repoRoot });
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.trim();
  };
  await git("init", "-b", "main");
  await git("config", "user.name", "Patchmill Test");
  await git("config", "user.email", "patchmill@example.test");
  await writeFile(
    join(config.repoRoot, ".gitignore"),
    ".patchmill/\n.worktrees/\n",
  );
  await git("add", ".gitignore");
  await git("commit", "-m", "Initial base");
  await git("branch", branch);
  let savedCommit = await git("rev-parse", "HEAD");
  if (options.source === "published") {
    selected.comments = [
      {
        author: { login: "patchmill-bot" },
        body: formatPublishedArtifactComment({ kind: "plan", path, content }),
      },
    ];
  } else {
    if (options.source === "branch") await git("switch", branch);
    await mkdir(dirname(join(config.repoRoot, path)), { recursive: true });
    await writeFile(join(config.repoRoot, path), content);
    await git("add", path);
    await git("commit", "-m", "Approved plan");
    savedCommit = await git("rev-parse", "HEAD");
    if (options.source === "branch") await git("switch", "main");
  }
  await git(
    "remote",
    "add",
    "origin",
    "https://forgejo.test/test-owner/test-repo.git",
  );
  await git(
    "update-ref",
    "refs/remotes/origin/main",
    await git("rev-parse", "main"),
  );
  await git(
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  );
  await writeFixtureRunState(
    config.runStateDir,
    {
      issueNumber: 140,
      title: selected.title,
      status: "implementing",
      branch,
      planPath: path,
      planCommit: savedCommit,
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
      },
    },
    now.toISOString(),
  );

  let agentCalls = 0;
  let contentAtAgent: string | undefined;
  let agentCwd: string | undefined;
  let materializationHookCalled = false;
  const calls: Call[] = [];
  return {
    config,
    path,
    content,
    branch,
    savedCommit,
    git,
    calls,
    agents: () => agentCalls,
    contentAtAgent: () => contentAtAgent,
    agentCwd: () => agentCwd,
    run: () =>
      runLegacyOneIssue(
        {
          async run(command, args, runOptions = {}) {
            const call = normalizeRecordedPiCall({
              command,
              args: [...args],
              cwd: runOptions.cwd,
            });
            calls.push(call);
            if (call.command === "git") {
              const result = await actual.run(command, args, runOptions);
              if (
                args[0] === "worktree" &&
                args[1] === "add" &&
                result.code === 0 &&
                options.afterWorktree
              )
                await options.afterWorktree(
                  resolve(config.repoRoot, args[args.length - 2]!),
                );
              if (
                args[0] === "rev-parse" &&
                runOptions.cwd !== config.repoRoot &&
                options.afterMaterialization &&
                !materializationHookCalled
              ) {
                materializationHookCalled = true;
                await options.afterMaterialization(runOptions.cwd!);
              }
              return result;
            }
            if (call.command === "tea") {
              if (args[0] === "issues" && args[1] === "list")
                return {
                  code: 0,
                  stdout:
                    args[args.indexOf("--page") + 1] === "1"
                      ? issueListPayload([selected])
                      : "[]",
                  stderr: "",
                };
              if (args[0] === "labels" && args[1] === "list")
                return { code: 0, stdout: labelListPayload(), stderr: "" };
              if (args[0] === "logins")
                return {
                  code: 0,
                  stdout:
                    '[{"name":"default","user":"patchmill-bot","default":true}]',
                  stderr: "",
                };
              if (args[0] === "api" && args[1]?.includes("/pulls"))
                return { code: 0, stdout: "[]", stderr: "" };
              if (args[0] === "api")
                return {
                  code: 0,
                  stdout:
                    '{"name":"test-repo","full_name":"test-owner/test-repo","owner":{"login":"test-owner"},"html_url":"https://forgejo.test/test-owner/test-repo"}',
                  stderr: "",
                };
              return { code: 0, stdout: "", stderr: "" };
            }
            if (call.command === "pi") {
              agentCalls++;
              agentCwd = call.cwd;
              const prompt = await readFile(promptPath(call.args), "utf8");
              assert.ok(prompt.includes(path), prompt);
              try {
                contentAtAgent = await readFile(join(call.cwd!, path), "utf8");
              } catch {
                contentAtAgent = undefined;
              }
              return {
                code: 0,
                stdout: JSON.stringify({
                  status: "blocked",
                  reason: "Stop at the verified execution boundary",
                  questions: [],
                  commits: [],
                  validation: [],
                }),
                stderr: "",
              };
            }
            throw new Error(`Unexpected command ${command} ${args.join(" ")}`);
          },
        },
        config,
        { now },
      ),
  };
}
