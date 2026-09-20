import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planningIssueLockPath } from "../../../workflow/planning-issue-lock.ts";
import { planningStatePath } from "../../../workflow/planning-state-store.ts";
import { DEFAULT_TRIAGE_POLICY } from "../triage/labels.ts";
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
import { createMockRunner } from "../../../../test-support/run-once/mock-runner.ts";
import { runOneIssue } from "./pipeline.ts";
import { runStatePath, writeRunState } from "./run-state.ts";
import { exitCodeForRunOnceResult } from "./result-output.ts";
import { summarizeResult } from "./result-summary.ts";

test("facade dispatches fresh plan-only selection to the planning lock boundary", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const selected = issue(189, ["agent-ready"], "Fresh planning selection");
  const lockPath = planningIssueLockPath(config.runStateDir, selected.number);
  await mkdir(join(config.runStateDir, "planning-pr-v1", "locks"), {
    recursive: true,
  });
  await writeFile(
    lockPath,
    `${JSON.stringify({
      version: 1,
      issueNumber: selected.number,
      runId: "123e4567-e89b-42d3-a456-426614174000",
      ownershipId: "223e4567-e89b-42d3-a456-426614174000",
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: "2026-01-01T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args[0] === "issues") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  try {
    const result = await runOneIssue(runner, config);
    assert.equal(result.status, "stopped");
    if (result.status === "stopped")
      assert.equal(result.reason, "issue-locked");
    assert.equal(
      runner.calls.some((call) => call.args.includes("edit")),
      false,
    );
  } finally {
    await rm(config.repoRoot, { recursive: true, force: true });
  }
});

test("facade falls back after a pinned legacy candidate becomes approval-wait", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
    approvalPolicy: approvalPolicy({ specRequired: true, planRequired: true }),
    triagePolicy: {
      ...DEFAULT_TRIAGE_POLICY,
      runOnceSelection: {
        ...DEFAULT_TRIAGE_POLICY.runOnceSelection,
        priorityOrder: ["priority:critical", "priority:low"],
      },
    },
  } as never);
  const legacy = issue(272, ["agent-ready"], "Legacy candidate");
  const low = issue(326, ["agent-ready", "priority:low"], "Low fallback");
  const high = issue(
    327,
    ["agent-ready", "priority:critical"],
    "High fallback",
  );
  await writeRunState(config.runStateDir, {
    issueNumber: legacy.number,
    title: legacy.title,
    status: "finished",
    specPath: "docs/specs/issue-272.md",
    branch: "agent/issue-272",
  });
  const lockPath = planningIssueLockPath(config.runStateDir, high.number);
  await mkdir(join(config.runStateDir, "planning-pr-v1", "locks"), {
    recursive: true,
  });
  await writeFile(
    lockPath,
    `${JSON.stringify({
      version: 1,
      issueNumber: high.number,
      runId: "123e4567-e89b-42d3-a456-426614174000",
      ownershipId: "223e4567-e89b-42d3-a456-426614174000",
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: "2026-01-01T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  let legacyViews = 0;
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args[0] === "issues") {
      const state = call.args.includes("--state")
        ? call.args[call.args.indexOf("--state") + 1]
        : call.args.find((arg) => arg.startsWith("--state="))?.slice(8);
      if (state === "open") {
        const page = call.args.includes("--page")
          ? call.args[call.args.indexOf("--page") + 1]
          : call.args.find((arg) => arg.startsWith("--page="))?.slice(7);
        return {
          code: 0,
          stdout: page === "1" ? issueListPayload([legacy, low, high]) : "[]",
          stderr: "",
        };
      }
      if (state === "all") {
        legacyViews += 1;
        return {
          code: 0,
          stdout: issueListPayload([
            legacyViews === 1
              ? legacy
              : issue(272, ["agent-ready", "spec-review"], legacy.title),
          ]),
          stderr: "",
        };
      }
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  try {
    const result = await runOneIssue(runner, config);
    assert.equal(result.status, "stopped");
    if (result.status === "stopped") {
      assert.equal(result.issue.number, high.number);
      assert.equal(result.reason, "issue-locked");
    }
    assert.equal(legacyViews, 2);
    assert.equal(
      runner.calls.some((call) => call.args.includes("edit")),
      false,
    );
    assert.equal(
      runner.calls.some((call) => call.args.includes("326")),
      false,
    );
    await assert.rejects(
      readFile(join(config.runStateDir, "locks", "issue-272.lock"), "utf8"),
      { code: "ENOENT" },
    );
  } finally {
    await rm(config.repoRoot, { recursive: true, force: true });
  }
});

test("facade skips malformed recovery state after a pinned candidate becomes approval-wait", async () => {
  for (const reviewLabel of ["spec-review", "plan-review"] as const) {
    const config = await makeConfig({
      dryRun: false,
      execute: true,
      planOnly: true,
      approvalPolicy: approvalPolicy({
        specRequired: true,
        planRequired: true,
      }),
    } as never);
    const legacy = issue(272, ["agent-ready"], "Legacy candidate");
    const fresh = issue(327, ["agent-ready"], "Fresh fallback");
    await writeRunState(config.runStateDir, {
      issueNumber: legacy.number,
      title: legacy.title,
      status: "finished",
      specPath: "docs/specs/issue-272.md",
      branch: "agent/issue-272",
    });
    const lockPath = planningIssueLockPath(config.runStateDir, fresh.number);
    await mkdir(join(config.runStateDir, "planning-pr-v1", "locks"), {
      recursive: true,
    });
    await writeFile(
      lockPath,
      `${JSON.stringify({
        version: 1,
        issueNumber: fresh.number,
        runId: "123e4567-e89b-42d3-a456-426614174000",
        ownershipId: "223e4567-e89b-42d3-a456-426614174000",
        pid: process.pid,
        hostname: hostname(),
        acquiredAt: "2026-01-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    let legacyViews = 0;
    const runner = createMockRunner(async (call) => {
      if (call.command === "tea" && call.args[0] === "issues") {
        const state = call.args.includes("--state")
          ? call.args[call.args.indexOf("--state") + 1]
          : call.args.find((arg) => arg.startsWith("--state="))?.slice(8);
        if (state === "open") {
          const page = call.args.includes("--page")
            ? call.args[call.args.indexOf("--page") + 1]
            : call.args.find((arg) => arg.startsWith("--page="))?.slice(7);
          return {
            code: 0,
            stdout: page === "1" ? issueListPayload([legacy, fresh]) : "[]",
            stderr: "",
          };
        }
        if (state === "all") {
          legacyViews += 1;
          await writeFile(
            runStatePath(config.runStateDir, legacy.number),
            "{invalid-json",
            "utf8",
          );
          return {
            code: 0,
            stdout: issueListPayload([
              issue(legacy.number, ["agent-ready", reviewLabel], legacy.title),
            ]),
            stderr: "",
          };
        }
      }
      throw new Error(
        `unexpected command: ${call.command} ${call.args.join(" ")}`,
      );
    });
    try {
      const result = await runOneIssue(runner, config);
      assert.equal(result.status, "stopped");
      if (result.status === "stopped") {
        assert.equal(result.issue.number, fresh.number);
        assert.equal(result.reason, "issue-locked");
      }
      assert.equal(legacyViews, 1);
      assert.equal(
        runner.calls.some((call) => call.args.includes("edit")),
        false,
      );
      await assert.rejects(
        readFile(join(config.runStateDir, "locks", "issue-272.lock"), "utf8"),
        { code: "ENOENT" },
      );
    } finally {
      await rm(config.repoRoot, { recursive: true, force: true });
    }
  }
});

test("facade falls back when a resumable legacy candidate becomes approval-wait", async () => {
  for (const reviewLabel of ["spec-review", "plan-review"] as const) {
    const config = await makeConfig({
      dryRun: false,
      execute: true,
      planOnly: true,
      approvalPolicy: approvalPolicy({
        specRequired: true,
        planRequired: true,
      }),
    } as never);
    const legacy = issue(272, ["in-progress"], "Resumable candidate");
    const fresh = issue(327, ["agent-ready"], "Fresh fallback");
    await writeRunState(config.runStateDir, {
      issueNumber: legacy.number,
      title: legacy.title,
      status: "planning",
      planPath: "docs/plans/issue-272-legacy.md",
      checkpoints: { claimed: true, startedCommentPosted: true },
    });
    const lockPath = planningIssueLockPath(config.runStateDir, fresh.number);
    await mkdir(join(config.runStateDir, "planning-pr-v1", "locks"), {
      recursive: true,
    });
    await writeFile(
      lockPath,
      `${JSON.stringify({
        version: 1,
        issueNumber: fresh.number,
        runId: "123e4567-e89b-42d3-a456-426614174000",
        ownershipId: "223e4567-e89b-42d3-a456-426614174000",
        pid: process.pid,
        hostname: hostname(),
        acquiredAt: "2026-01-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    let legacyViews = 0;
    const runner = createMockRunner((call) => {
      if (call.command === "tea" && call.args[0] === "issues") {
        const state = call.args.includes("--state")
          ? call.args[call.args.indexOf("--state") + 1]
          : call.args.find((arg) => arg.startsWith("--state="))?.slice(8);
        if (state === "open") {
          const page = call.args.includes("--page")
            ? call.args[call.args.indexOf("--page") + 1]
            : call.args.find((arg) => arg.startsWith("--page="))?.slice(7);
          return {
            code: 0,
            stdout: page === "1" ? issueListPayload([legacy, fresh]) : "[]",
            stderr: "",
          };
        }
        if (state === "all") {
          legacyViews += 1;
          return {
            code: 0,
            stdout: issueListPayload([
              legacyViews === 1
                ? legacy
                : issue(
                    legacy.number,
                    ["in-progress", reviewLabel],
                    legacy.title,
                  ),
            ]),
            stderr: "",
          };
        }
      }
      throw new Error(
        `unexpected command: ${call.command} ${call.args.join(" ")}`,
      );
    });
    try {
      const result = await runOneIssue(runner, config);
      assert.equal(result.status, "stopped");
      if (result.status === "stopped") {
        assert.equal(result.issue.number, fresh.number);
        assert.equal(result.reason, "issue-locked");
      }
      assert.equal(legacyViews, 2);
      assert.equal(
        runner.calls.some((call) => call.args.includes("edit")),
        false,
      );
      await assert.rejects(
        readFile(join(config.runStateDir, "locks", "issue-272.lock"), "utf8"),
        { code: "ENOENT" },
      );
    } finally {
      await rm(config.repoRoot, { recursive: true, force: true });
    }
  }
});

test("facade exhausts each safely rejected legacy candidate once", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    approvalPolicy: approvalPolicy({ specRequired: true, planRequired: true }),
  });
  const first = issue(272, ["agent-ready"], "First legacy candidate");
  const second = issue(326, ["agent-ready"], "Second legacy candidate");
  for (const selected of [first, second]) {
    await writeRunState(config.runStateDir, {
      issueNumber: selected.number,
      title: selected.title,
      status: "finished",
      specPath: `docs/specs/issue-${selected.number}.md`,
      branch: `agent/issue-${selected.number}`,
    });
  }
  const views = new Map<number, number>();
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args[0] === "issues") {
      const state = call.args[call.args.indexOf("--state") + 1];
      const page = call.args[call.args.indexOf("--page") + 1];
      if (state === "open")
        return {
          code: 0,
          stdout: page === "1" ? issueListPayload([first, second]) : "[]",
          stderr: "",
        };
      const number = Number(call.args[call.args.indexOf("--keyword") + 1]);
      views.set(number, (views.get(number) ?? 0) + 1);
      const selected = number === first.number ? first : second;
      return {
        code: 0,
        stdout: issueListPayload([
          issue(
            selected.number,
            ["agent-ready", "spec-review"],
            selected.title,
          ),
        ]),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  try {
    const result = await runOneIssue(runner, config);
    assert.deepEqual(result, { status: "no-issue" });
    assert.deepEqual(
      [...views.entries()],
      [
        [first.number, 1],
        [second.number, 1],
      ],
    );
    assert.equal(
      runner.calls.some(
        (call) =>
          call.command === "git" ||
          call.command === "pi" ||
          call.args.includes("edit"),
      ),
      false,
    );
  } finally {
    await rm(config.repoRoot, { recursive: true, force: true });
  }
});

test("facade propagates pinned legacy provider failures without fallback", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(272, ["agent-ready"], "Legacy candidate");
  const fresh = issue(327, ["agent-ready"], "Fresh candidate");
  await writeRunState(config.runStateDir, {
    issueNumber: selected.number,
    title: selected.title,
    status: "finished",
    specPath: "docs/specs/issue-272.md",
    branch: "agent/issue-272",
  });
  let views = 0;
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args[0] === "issues") {
      const state = call.args[call.args.indexOf("--state") + 1];
      const page = call.args[call.args.indexOf("--page") + 1];
      if (state === "open")
        return {
          code: 0,
          stdout: page === "1" ? issueListPayload([selected, fresh]) : "[]",
          stderr: "",
        };
      views += 1;
      if (views === 2) throw new Error("provider unavailable");
      return { code: 0, stdout: issueListPayload([selected]), stderr: "" };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  try {
    await assert.rejects(runOneIssue(runner, config), /provider unavailable/);
    assert.equal(views, 2);
    assert.equal(
      runner.calls.some((call) => call.args.includes(String(fresh.number))),
      false,
    );
    await assert.rejects(
      readFile(join(config.runStateDir, "locks", "issue-272.lock"), "utf8"),
      { code: "ENOENT" },
    );
  } finally {
    await rm(config.repoRoot, { recursive: true, force: true });
  }
});

test("facade keeps explicit approval diagnostics pinned to the requested issue", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 272,
    approvalPolicy: approvalPolicy({ specRequired: true, planRequired: true }),
  });
  const selected = issue(
    272,
    ["agent-ready", "spec-review"],
    "Explicit waiting issue",
  );
  const fresh = issue(327, ["agent-ready"], "Unselected fresh issue");
  await writeRunState(config.runStateDir, {
    issueNumber: selected.number,
    title: selected.title,
    status: "finished",
    specPath: "docs/specs/issue-272.md",
    branch: "agent/issue-272",
  });
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args[0] === "issues") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  try {
    const result = await runOneIssue(runner, config);
    assert.equal(result.status, "approval-required");
    if (result.status === "approval-required") {
      assert.equal(result.issue.number, selected.number);
      assert.equal(result.approvalKind, "spec");
      assert.equal(result.missingLabel, "spec-approved");
    }
    assert.equal(
      runner.calls.some((call) => call.args.includes(String(fresh.number))),
      false,
    );
  } finally {
    await rm(config.repoRoot, { recursive: true, force: true });
  }
});

test("facade routes an unfinished in-progress legacy run through legacy planning", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const selected = issue(189, ["in-progress"], "Legacy planning selection");
  const fresh = issue(190, ["agent-ready"], "Fresh planning selection");
  const planPath = "docs/plans/issue-189-legacy.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(config.runStateDir, {
    issueNumber: selected.number,
    title: selected.title,
    status: "planning",
    planPath,
    checkpoints: { claimed: true, startedCommentPosted: true },
  });
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args[0] === "issues") {
      if (call.args[1] === "list") {
        const page = call.args[call.args.indexOf("--page") + 1];
        return {
          code: 0,
          stdout: page === "1" ? issueListPayload([selected, fresh]) : "[]",
          stderr: "",
        };
      }
      return { code: 0, stdout: issueViewPayload(selected), stderr: "" };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  try {
    const result = await runOneIssue(runner, config);
    assert.match(result.status, /^plan-(created|found)$/);
    assert.equal(result.issue.number, selected.number);
    assert.equal(
      runner.calls.some(
        (call) =>
          call.command === "tea" &&
          call.args[0] === "issues" &&
          call.args[1] !== "list",
      ),
      true,
    );
    assert.equal(
      runner.calls.some((call) => call.args.includes("planning-pr-v1")),
      false,
    );
    assert.equal(
      runner.calls.some((call) => call.args.includes(String(fresh.number))),
      false,
    );
  } finally {
    await rm(config.repoRoot, { recursive: true, force: true });
  }
});

test("facade returns a blocked result for advisory malformed planning state", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(189, ["agent-ready"], "Malformed planning state");
  const statePath = planningStatePath(config.runStateDir, selected.number);
  await mkdir(join(config.runStateDir, "planning-pr-v1", "issues"), {
    recursive: true,
  });
  await writeFile(statePath, "{not-json", "utf8");
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args[0] === "issues") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  try {
    const result = await runOneIssue(runner, config);
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") {
      assert.match(result.reason, /planning-state-invalid/);
      assert.match(result.reason, /invalid-json/);
      assert.match(result.reason, /issue-189\.json/);
    }
    const summary = summarizeResult(result);
    assert.equal(summary.status, "blocked");
    assert.equal(exitCodeForRunOnceResult(summary), 1);
    assert.equal(
      runner.calls.some((call) => call.args.includes("edit")),
      false,
    );
  } finally {
    await rm(config.repoRoot, { recursive: true, force: true });
  }
});
