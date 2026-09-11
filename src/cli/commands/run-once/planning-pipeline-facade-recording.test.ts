import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import {
  approvalPolicy,
  makeConfig,
} from "../../../../test-support/run-once/pipeline-fixtures.ts";
import {
  issue,
  issueListPayload,
  issueViewPayload,
  labelListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";
import { promptPath } from "../../../../test-support/run-once/mock-runner.ts";
import { runOneIssue } from "./pipeline.ts";

const run = promisify(execFile);
const now = new Date("2099-01-01T00:00:00.000Z");

async function git(cwd: string, args: string[]) {
  try {
    const result = await run("git", args, { cwd, encoding: "utf8" });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

function repository() {
  return {
    name: "patchmill",
    full_name: "acme/patchmill",
    owner: { login: "acme" },
    html_url: "https://forge.test/acme/patchmill",
  };
}

type Pull = {
  number: number;
  branch: string;
  body: string;
  headOid: string;
  merged?: boolean;
  mergeOid?: string;
};

async function scenario(
  gates: { specRequired: boolean; planRequired: boolean },
  invalidImplementation = false,
) {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    allowDirectLand: true,
    approvalPolicy: approvalPolicy(gates),
  });
  // The public facade owns a real remote/base/worktree lifecycle; only Forgejo
  // and Pi are recorded at their process boundary.
  const remote = join(config.repoRoot, "remote.git");
  await mkdir(config.worktreeDir, { recursive: true });
  await git(config.repoRoot, ["init", "--initial-branch=main"]);
  await git(config.repoRoot, ["config", "user.email", "test@example.test"]);
  await git(config.repoRoot, ["config", "user.name", "Test"]);
  await writeFile(join(config.repoRoot, "README.md"), "# test\n", "utf8");
  await writeFile(join(config.specsDir, ".gitkeep"), "", "utf8");
  await writeFile(join(config.plansDir, ".gitkeep"), "", "utf8");
  await git(config.repoRoot, ["add", "README.md", "docs"]);
  await git(config.repoRoot, ["commit", "-m", "initial"]);
  await git(config.repoRoot, ["init", "--bare", remote]);
  await git(config.repoRoot, ["remote", "add", "origin", remote]);
  await git(config.repoRoot, ["push", "-u", "origin", "main"]);
  const selected = issue(189, ["agent-ready"], "Facade recording");
  const pulls: Pull[] = [];
  let nextPull = 1;
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const runner = {
    calls,
    async run(command: string, args: string[], options: { cwd?: string } = {}) {
      const call =
        command === process.execPath
          ? { command: "pi", args: args.slice(1), cwd: options.cwd }
          : { command, args, cwd: options.cwd };
      calls.push(call);
      if (call.command === "git") {
        if (call.args[0] === "remote" && call.args[1] === "get-url")
          return {
            code: 0,
            stdout: "https://forge.test/acme/patchmill.git\n",
            stderr: "",
          };
        const result = await git(call.cwd ?? config.repoRoot, call.args);
        if (
          call.args[0] === "worktree" &&
          call.args[1] === "add" &&
          result.code !== 0
        )
          throw new Error(result.stderr);
        return result;
      }
      if (call.command === "pi") {
        const prompt = await readFile(promptPath(call.args), "utf8");
        const path = /"(?:specPath|planPath)"\s*:\s*"([^"]+)"/u.exec(
          prompt,
        )?.[1];
        if (path) {
          await mkdir(dirname(join(call.cwd!, path)), { recursive: true });
          await writeFile(join(call.cwd!, path), "# artifact\n", "utf8");
          await git(call.cwd!, ["add", path]);
          await git(call.cwd!, ["commit", "-m", "planning artifact"]);
          const commit = await git(call.cwd!, ["rev-parse", "HEAD"]);
          return {
            code: 0,
            stdout: JSON.stringify({
              status: path.includes("specs") ? "spec-created" : "plan-created",
              ...(path.includes("specs")
                ? { specPath: path }
                : { planPath: path }),
              commit: commit.stdout.trim(),
            }),
            stderr: "",
          };
        }
        await writeFile(
          join(call.cwd!, "implementation.txt"),
          "implemented\n",
          "utf8",
        );
        await git(call.cwd!, ["add", "implementation.txt"]);
        await git(call.cwd!, ["commit", "-m", "implementation"]);
        const branch = (
          await git(call.cwd!, ["branch", "--show-current"])
        ).stdout.trim();
        const headOid = (
          await git(call.cwd!, ["rev-parse", "HEAD"])
        ).stdout.trim();
        await git(call.cwd!, ["push", "origin", `HEAD:${branch}`]);
        pulls.push({
          number: 99,
          branch,
          headOid,
          body: invalidImplementation
            ? "Closes #189"
            : "Closes #189\n\n<!-- patchmill:planning-pr-v1 issue=189 phase=implementation -->",
        });
        return {
          code: 0,
          stdout: JSON.stringify({
            status: "pr-created",
            prUrl: "https://forge.test/acme/patchmill/pulls/99",
            branch,
            commits: [headOid],
            validation: ["npm test"],
          }),
          stderr: "",
        };
      }
      if (call.command === "tea" && call.args[0] === "issues") {
        if (call.args[1] === "list") {
          const page = call.args[call.args.indexOf("--page") + 1];
          return {
            code: 0,
            stdout: page === "1" ? issueListPayload([selected]) : "[]",
            stderr: "",
          };
        }
        return { code: 0, stdout: issueViewPayload(selected), stderr: "" };
      }
      if (call.command === "tea" && call.args[0] === "labels")
        return { code: 0, stdout: labelListPayload(), stderr: "" };
      if (call.command === "tea" && !call.args.includes("api"))
        return { code: 0, stdout: "", stderr: "" };
      if (call.command === "tea") {
        const path =
          call.args.find((value) => value.startsWith("/repos/")) ?? "";
        if (path.endsWith("/repos/{owner}/{repo}"))
          return { code: 0, stdout: JSON.stringify(repository()), stderr: "" };
        if (path.includes("/pulls?"))
          return {
            code: 0,
            stdout: JSON.stringify(pulls.map(pullPayload)),
            stderr: "",
          };
        if (/\/pulls\/\d+$/u.test(path)) {
          const number = Number(path.split("/").at(-1));
          return {
            code: 0,
            stdout: JSON.stringify(
              pullPayload(pulls.find((pull) => pull.number === number)!),
            ),
            stderr: "",
          };
        }
        if (path.endsWith("/pulls")) {
          const head = call.args
            .find((value) => value.startsWith("head="))!
            .slice(5)
            .split(":")
            .at(-1)!;
          const body = call.args
            .find((value) => value.startsWith("body="))!
            .slice(5);
          const headOid = (
            await git(config.repoRoot, ["rev-parse", `refs/heads/${head}`])
          ).stdout.trim();
          const pull = { number: nextPull++, branch: head, body, headOid };
          pulls.push(pull);
          return {
            code: 0,
            stdout: JSON.stringify(pullPayload(pull)),
            stderr: "",
          };
        }
      }
      throw new Error(
        `unexpected command: ${call.command} ${call.args.join(" ")}`,
      );
    },
  };
  function pullPayload(pull: Pull) {
    return {
      number: pull.number,
      html_url: `https://forge.test/acme/patchmill/pulls/${pull.number}`,
      body: pull.body,
      state: pull.merged ? "closed" : "open",
      merged: pull.merged === true,
      merge_commit_sha: pull.mergeOid ?? null,
      base: { ref: "main", repo: repository() },
      head: { ref: pull.branch, sha: pull.headOid, repo: repository() },
    };
  }
  async function mergePlanningPull() {
    const pull = pulls.find((item) => item.number !== 99 && !item.merged)!;
    const merged = await git(config.repoRoot, [
      "merge",
      "--no-ff",
      `origin/${pull.branch}`,
      "-m",
      "merge planning",
    ]);
    assert.equal(merged.code, 0, merged.stderr);
    pull.mergeOid = (
      await git(config.repoRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();
    pull.merged = true;
    await git(config.repoRoot, ["push", "origin", "main"]);
  }
  return {
    config,
    runner,
    mergePlanningPull,
    state: () => new PlanningStateStore(config.runStateDir).read(189),
  };
}

test("runOneIssue records all planning gate sequences through merged-base and implementation finish", async () => {
  for (const [gates, reviews] of [
    [{ specRequired: false, planRequired: false }, []],
    [{ specRequired: true, planRequired: false }, ["spec"]],
    [{ specRequired: false, planRequired: true }, ["plan"]],
    [{ specRequired: true, planRequired: true }, ["spec", "plan"]],
  ] as const) {
    const subject = await scenario(gates);
    try {
      for (const phase of reviews) {
        const review = await runOneIssue(subject.runner, subject.config, {
          now,
        });
        assert.equal(review.status, "review-pending");
        if (review.status === "review-pending")
          assert.equal(review.phase, phase);
        const saved = await subject.state();
        assert.equal(
          saved?.phases.find((item) => item.kind === phase)?.status,
          "pull-request-open",
        );
        await subject.mergePlanningPull();
      }
      const result = await runOneIssue(subject.runner, subject.config, { now });
      assert.equal(result.status, "pr-created");
      const saved = await subject.state();
      assert.equal(saved?.phases.at(-1)?.status, "complete");
      assert.ok(saved?.revision && saved.revision > reviews.length);
      assert.equal(
        subject.runner.calls.some(
          (call) => call.command === "git" && call.args.includes("fetch"),
        ),
        true,
      );
    } finally {
      await rm(subject.config.repoRoot, { recursive: true, force: true });
    }
  }
});

test("runOneIssue validation failure checkpoints before finish cleanup", async () => {
  const subject = await scenario(
    { specRequired: false, planRequired: false },
    true,
  );
  try {
    const result = await runOneIssue(subject.runner, subject.config, { now });
    assert.equal(result.status, "blocked");
    const saved = await subject.state();
    assert.equal(saved?.phases.at(-1)?.status, "branch-pushed");
    assert.equal(
      subject.runner.calls.some(
        (call) =>
          call.command === "git" &&
          call.args[0] === "worktree" &&
          call.args[1] === "remove",
      ),
      false,
    );
  } finally {
    await rm(subject.config.repoRoot, { recursive: true, force: true });
  }
});
