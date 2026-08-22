import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatErrorWithCauses } from "./pi-errors.ts";
import { finalLogPath, writePipelineFailureResult } from "./main.ts";
import type { AgentIssuePipelineResult } from "./types.ts";
import {
  exitCodeForRunOnceResult,
  writeRunOnceResult,
} from "./result-output.ts";
import type { RunOnceResultSummary } from "./result-summary.ts";

const summary: RunOnceResultSummary = {
  status: "pr-created",
  issueNumber: 174,
  planPath: "docs/plans/plan.md",
  branch: "agent/issue-174",
  prUrl: "https://example.test/pulls/174",
  worktreePath: ".worktrees/issue-174",
  commits: ["abc123"],
  validation: ["npm test passed"],
};
test("writes human TTY output but exact compact JSON when redirected", async () => {
  const interactive: string[] = [];
  await writeRunOnceResult(summary, {
    stdout: {
      isTTY: true,
      columns: 80,
      write: (chunk) => interactive.push(String(chunk)),
    },
    env: { TERM: "xterm" },
  });
  assert.match(interactive.join(""), /Final result:.*PR created/u);
  assert.match(interactive.join(""), /\u001b\[/u);
  const redirected: string[] = [];
  await writeRunOnceResult(summary, {
    stdout: { isTTY: false, write: (chunk) => redirected.push(String(chunk)) },
    env: { TERM: "xterm" },
  });
  assert.equal(redirected.join(""), `${JSON.stringify(summary)}\n`);
});
test("persistence rejection leaves stdout untouched and preserves pipeline causes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-result-directory-"));
  const output: string[] = [];
  const pipelineError = new AggregateError(
    [
      new Error("pipeline failed"),
      new Error("error reporting: observer failed"),
    ],
    "pipeline failed",
  );

  await assert.rejects(
    writePipelineFailureResult(pipelineError, dir, {
      stdout: { isTTY: false, write: (chunk) => output.push(String(chunk)) },
      env: {},
    }),
    (error: unknown) => {
      assert.deepEqual(formatErrorWithCauses(error), {
        message: "pipeline failed",
        causes: [
          "pipeline failed",
          "error reporting: observer failed",
          `result reporting: EISDIR: illegal operation on a directory, open '${dir}'`,
        ],
      });
      return true;
    },
  );
  assert.deepEqual(output, []);
});

test("fails rather than splitting a result log when its preliminary log cannot rename", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-final-log-"));
  const preliminaryLogPath = join(dir, "missing.jsonl");
  await assert.rejects(
    finalLogPath(preliminaryLogPath, dir, "2026-08-22T11:00:00.000Z", {
      status: "spec-created",
      issue: {
        number: 174,
        title: "Issue",
        body: "",
        labels: [],
        state: "open",
      },
      specPath: "docs/specs/result.md",
    } satisfies AgentIssuePipelineResult),
    /ENOENT/u,
  );
});

test("gates terminal color without changing TTY mode and falls back to width 80", async () => {
  for (const env of [{ NO_COLOR: "1" }, { TERM: "dumb" }]) {
    const output: string[] = [];
    await writeRunOnceResult(summary, {
      stdout: {
        isTTY: true,
        columns: 0,
        write: (chunk) => output.push(String(chunk)),
      },
      env,
    });
    assert.match(output.join(""), /Final result: ✓ PR created/u);
    assert.doesNotMatch(output.join(""), /\u001b\[/u);
  }
  const redirected: string[] = [];
  await writeRunOnceResult(summary, {
    stdout: { isTTY: false, write: (chunk) => redirected.push(String(chunk)) },
    env: {},
  });
  assert.doesNotMatch(redirected.join(""), /\u001b\[/u);
});

test("writes severity-specific complete JSONL result events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-result-level-"));
  const cases: Array<[RunOnceResultSummary, "warning" | "error"]> = [
    [
      {
        status: "approval-required",
        issueNumber: 174,
        approvalKind: "spec",
        missingLabel: "spec-approved",
      },
      "warning",
    ],
    [{ status: "error", error: "failed" }, "error"],
  ];
  for (const [result, level] of cases) {
    const path = join(dir, `${result.status}.jsonl`);
    await writeRunOnceResult(result, {
      stdout: { isTTY: false, write() {} },
      env: {},
      logPath: path,
      time: new Date("2026-08-22T11:00:00.000Z"),
    });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      time: "2026-08-22T11:00:00.000Z",
      level,
      stage: "result",
      message: `final result ${result.status}`,
      data: result,
    });
  }
});

test("preserves the exit-code contract for every status", () => {
  const cases: Array<[RunOnceResultSummary, 0 | 1]> = [
    [{ status: "no-issue" }, 0],
    [
      { status: "dry-run", issueNumber: 1, title: "Issue", transition: "plan" },
      0,
    ],
    [{ status: "spec-created", issueNumber: 1, specPath: "spec.md" }, 0],
    [{ status: "spec-found", issueNumber: 1, specPath: "spec.md" }, 0],
    [{ status: "plan-created", issueNumber: 1, planPath: "plan.md" }, 0],
    [{ status: "plan-found", issueNumber: 1, planPath: "plan.md" }, 0],
    [summary, 0],
    [{ ...summary, status: "merged", mergeCommit: "abc" }, 0],
    [
      {
        status: "approval-required",
        issueNumber: 1,
        approvalKind: "spec",
        missingLabel: "ok",
      },
      1,
    ],
    [
      {
        status: "development-environment-not-ready",
        issueNumber: 1,
        planPath: "plan.md",
        reason: "no",
        evidence: [],
        remediation: [],
      },
      1,
    ],
    [{ status: "blocked", issueNumber: 1, reason: "no", questions: [] }, 1],
    [{ status: "error", error: "no" }, 1],
  ];
  for (const [result, code] of cases)
    assert.equal(exitCodeForRunOnceResult(result), code);
});

test("persists structured result before stdout and maps exit status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-result-"));
  const path = join(dir, "run.jsonl");
  const output: string[] = [];
  await writeRunOnceResult(summary, {
    stdout: { isTTY: false, write: (chunk) => output.push(String(chunk)) },
    env: {},
    logPath: path,
    time: new Date("2026-08-22T11:00:00.000Z"),
  });
  const event = JSON.parse((await readFile(path, "utf8")).trim());
  assert.deepEqual(event.data, summary);
  assert.equal(event.stage, "result");
  assert.equal(event.level, "info");
  assert.equal(exitCodeForRunOnceResult(summary), 0);
  assert.equal(
    exitCodeForRunOnceResult({
      status: "blocked",
      issueNumber: 1,
      reason: "no",
      questions: [],
    }),
    1,
  );
});
