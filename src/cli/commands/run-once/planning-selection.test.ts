import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  legacyActiveForIssue,
  selectRunOnceWorkflow,
} from "./planning-selection.ts";
import { writeRunState } from "./run-state.ts";
import { assertPlanningStateReplacement } from "../../../workflow/planning-state.ts";

const issue = (number: number, labels: string[]) => ({
  number,
  title: `Issue ${number}`,
  state: "open",
  labels,
});
const config = {
  runStateDir: "/tmp/no-planning-selection-state",
  readyLabel: "agent-ready",
  issueNumber: undefined,
  approvalPolicy: {
    specApproval: { required: false },
    planApproval: { required: false },
  },
  triagePolicy: {
    runOnceSelection: { priorityOrder: ["priority:high", "priority:low"] },
  },
} as never;
const approvalConfig = {
  ...config,
  approvalPolicy: {
    specApproval: {
      kind: "spec",
      required: true,
      reviewLabel: "spec-review",
      approvedLabel: "spec-approved",
    },
    planApproval: {
      kind: "plan",
      required: true,
      reviewLabel: "plan-review",
      approvedLabel: "plan-approved",
    },
  },
} as never;

test("prioritizes active planning over fresh ready work and reuses label ordering", async () => {
  const active = { phases: [{ status: "pending" }] };
  const result = await selectRunOnceWorkflow(
    [issue(4, ["agent-ready", "priority:low"]), issue(3, ["priority:high"])],
    config,
    {
      path: () => "state",
      read: async (number) => (number === 3 ? active : undefined),
    } as never,
  );
  assert.equal(result.kind, "planning");
  if (result.kind === "planning") assert.equal(result.issue.number, 3);
});

test("selects pending publication reconciliation but requires ready for cleanup retry", async () => {
  const pending = {
    phases: [
      {
        kind: "implementation",
        status: "pull-request-open",
        workspace: { cleanup: { state: "cleanup-pending" } },
        pullRequest: { url: "https://example.test/pr/1" },
      },
    ],
  } as never;
  for (const [labels, kind] of [
    [[], "planning"],
    [["in-progress"], "planning"],
    [["in-progress", "needs-info"], "none"],
    [["agent-ready"], "planning"],
    [["agent-ready", "needs-info"], "planning"],
  ] as const) {
    const result = await selectRunOnceWorkflow([issue(3, labels)], config, {
      path: () => "state",
      read: async () => pending,
    } as never);
    assert.equal(result.kind, kind);
  }
});

test("excludes blocked fresh work and honors configured legacy in-progress labels", async () => {
  const custom = {
    ...config,
    triagePolicy: {
      labels: {
        ready: "queued",
        inProgress: "claimed",
        done: "closed",
        needsInfo: "blocked",
      },
      runOnceSelection: {
        priorityOrder: [],
        excludedLabels: ["unsuitable"],
      },
    },
  } as never;
  const result = await selectRunOnceWorkflow(
    [issue(1, ["queued", "unsuitable"]), issue(2, ["claimed"])],
    custom,
    { path: () => "state", read: async () => undefined } as never,
  );
  assert.equal(result.kind, "none");
});

test("selects an ordinary in-progress legacy run despite configured exclusions", async () => {
  const runStateDir = await mkdtemp(join(tmpdir(), "planning-selection-"));
  try {
    await writeRunState(runStateDir, {
      issueNumber: 3,
      title: "Issue 3",
      status: "planning",
    });
    const result = await selectRunOnceWorkflow(
      [issue(3, ["in-progress", "unsuitable"]), issue(4, ["agent-ready"])],
      {
        ...config,
        runStateDir,
        triagePolicy: {
          runOnceSelection: {
            priorityOrder: [],
            excludedLabels: ["unsuitable"],
          },
        },
      } as never,
      { path: () => "state", read: async () => undefined } as never,
    );
    assert.equal(result.kind, "legacy");
    if (result.kind === "legacy") assert.equal(result.issue.number, 3);
  } finally {
    await rm(runStateDir, { recursive: true, force: true });
  }
});

test("keeps a finished legacy planning workspace on the legacy route", () => {
  assert.equal(
    legacyActiveForIssue(issue(3, ["agent-ready"]), config, {
      status: "finished",
      specPath: "docs/specs/issue-3.md",
      branch: "agent/issue-3",
    } as never),
    true,
  );
});

test("selects a finished legacy planning workspace over fresh planning", async () => {
  const runStateDir = await mkdtemp(join(tmpdir(), "planning-selection-"));
  try {
    await writeRunState(runStateDir, {
      issueNumber: 3,
      title: "Issue 3",
      status: "finished",
      specPath: "docs/specs/issue-3.md",
      branch: "agent/issue-3",
    });
    const result = await selectRunOnceWorkflow(
      [issue(3, ["agent-ready"]), issue(4, ["agent-ready"])],
      { ...config, runStateDir },
      { path: () => "state", read: async () => undefined } as never,
    );
    assert.equal(result.kind, "legacy");
    if (result.kind === "legacy") assert.equal(result.issue.number, 3);
  } finally {
    await rm(runStateDir, { recursive: true, force: true });
  }
});

test("selects approval-resumed finished legacy planning workspaces", async () => {
  const runStateDir = await mkdtemp(join(tmpdir(), "planning-selection-"));
  try {
    await writeRunState(runStateDir, {
      issueNumber: 3,
      title: "Issue 3",
      status: "finished",
      specPath: "docs/specs/issue-3.md",
      branch: "agent/issue-3",
    });
    const approvalConfig = {
      ...config,
      runStateDir,
      approvalPolicy: {
        specApproval: {
          kind: "spec",
          required: true,
          reviewLabel: "spec-review",
          approvedLabel: "spec-approved",
        },
        planApproval: {
          kind: "plan",
          required: true,
          reviewLabel: "plan-review",
          approvedLabel: "plan-approved",
        },
      },
    } as never;
    for (const label of ["spec-approved", "plan-approved"]) {
      const result = await selectRunOnceWorkflow(
        [issue(3, [label]), issue(4, ["agent-ready"])],
        approvalConfig,
        { path: () => "state", read: async () => undefined } as never,
      );
      assert.equal(result.kind, "legacy");
      if (result.kind === "legacy") assert.equal(result.issue.number, 3);
    }
  } finally {
    await rm(runStateDir, { recursive: true, force: true });
  }
});

test("reserves blocked legacy recovery for an explicit ready retry", () => {
  const blocked = { status: "blocked", lastError: "needs input" } as never;
  assert.equal(
    legacyActiveForIssue(issue(3, ["agent-ready"]), config, blocked),
    false,
  );
  assert.equal(
    legacyActiveForIssue(issue(3, []), { ...config, issueNumber: 3 }, blocked),
    true,
  );
});

test("does not let an automatic blocked legacy retry outrank fresh work", async () => {
  const runStateDir = await mkdtemp(join(tmpdir(), "planning-selection-"));
  try {
    await writeRunState(runStateDir, {
      issueNumber: 3,
      title: "Issue 3",
      status: "blocked",
      lastError: "needs input",
    });
    const blockedIssue = issue(3, ["agent-ready"]);
    const freshIssue = issue(4, ["agent-ready"]);
    const automatic = await selectRunOnceWorkflow(
      [blockedIssue, freshIssue],
      { ...config, runStateDir },
      { path: () => "state", read: async () => undefined } as never,
    );
    assert.equal(automatic.kind, "fresh-planning");
    if (automatic.kind === "fresh-planning")
      assert.equal(automatic.issue.number, 4);
    const explicit = await selectRunOnceWorkflow(
      [blockedIssue, freshIssue],
      { ...config, runStateDir, issueNumber: 3 },
      { path: () => "state", read: async () => undefined } as never,
    );
    assert.equal(explicit.kind, "legacy");
    const unacknowledged = await selectRunOnceWorkflow(
      [issue(3, ["in-progress"])],
      { ...config, runStateDir, issueNumber: 3 },
      { path: () => "state", read: async () => undefined } as never,
    );
    assert.equal(unacknowledged.kind, "none");
  } finally {
    await rm(runStateDir, { recursive: true, force: true });
  }
});

test("rejects active planning state that conflicts with blocked legacy recovery during automatic selection", async () => {
  const runStateDir = await mkdtemp(join(tmpdir(), "planning-selection-"));
  try {
    await writeRunState(runStateDir, {
      issueNumber: 3,
      title: "Issue 3",
      status: "blocked",
      lastError: "needs input",
    });
    const result = await selectRunOnceWorkflow(
      [issue(3, ["in-progress"])],
      { ...config, runStateDir },
      {
        path: () => "state",
        read: async () => ({ phases: [{ status: "pending" }] }),
      } as never,
    );
    assert.equal(result.kind, "invalid-planning-state");
    if (result.kind === "invalid-planning-state")
      assert.equal(result.reason, "planning and legacy state are both active");
  } finally {
    await rm(runStateDir, { recursive: true, force: true });
  }
});

test("returns malformed planning state rather than selecting fresh work", async () => {
  const result = await selectRunOnceWorkflow(
    [issue(3, ["agent-ready"])],
    config,
    {
      path: () => "state",
      read: async () => {
        throw new Error("invalid-json");
      },
    } as never,
  );
  assert.equal(result.kind, "invalid-planning-state");
  if (result.kind === "invalid-planning-state")
    assert.match(result.reason, /state: planning state read failed/);
});

test("stamps fresh planning state with the run clock so the first revision edge validates", async () => {
  // Production freezes options.now at process start; state creation happens
  // later, so a live clock here makes the first update fail timestamp-order.
  const runStart = "2026-09-12T19:35:15.658Z";
  const result = await selectRunOnceWorkflow(
    [issue(4, ["agent-ready"])],
    config,
    { path: () => "state", read: async () => undefined } as never,
    runStart,
  );
  assert.equal(result.kind, "fresh-planning");
  if (result.kind !== "fresh-planning") return;
  assert.equal(result.initialState.createdAt, runStart);
  assert.equal(result.initialState.updatedAt, runStart);
  assertPlanningStateReplacement(result.initialState, {
    ...result.initialState,
    revision: 1,
    updatedAt: runStart,
  });
});

test("omits approval-wait legacy resumes but keeps approved resumes eligible", async () => {
  const runStateDir = await mkdtemp(join(tmpdir(), "planning-selection-"));
  try {
    await writeRunState(runStateDir, {
      issueNumber: 272,
      title: "Issue 272",
      status: "finished",
      specPath: "docs/specs/issue-272.md",
      branch: "agent/issue-272",
    });
    for (const [reviewLabel, approvedLabel] of [
      ["spec-review", "spec-approved"],
      ["plan-review", "plan-approved"],
    ] as const) {
      const waiting = await selectRunOnceWorkflow(
        [
          issue(272, ["agent-ready", reviewLabel, "priority:high"]),
          issue(327, ["agent-ready", "priority:low"]),
        ],
        { ...approvalConfig, runStateDir },
        { path: () => "state", read: async () => undefined } as never,
      );
      assert.equal(waiting.kind, "fresh-planning");
      if (waiting.kind === "fresh-planning")
        assert.equal(waiting.issue.number, 327);

      const approved = await selectRunOnceWorkflow(
        [
          issue(272, ["agent-ready", reviewLabel, approvedLabel]),
          issue(327, ["agent-ready"]),
        ],
        { ...approvalConfig, runStateDir },
        { path: () => "state", read: async () => undefined } as never,
      );
      assert.equal(approved.kind, "legacy");
      if (approved.kind === "legacy") assert.equal(approved.issue.number, 272);
    }
  } finally {
    await rm(runStateDir, { recursive: true, force: true });
  }
});

test("omits approval-wait issues before planning-state reads in every automatic choice branch", async () => {
  const reads: number[] = [];
  const state = {
    path: (number: number) => `issue-${number}.json`,
    read: async (number: number) => {
      reads.push(number);
      if (number === 272)
        throw new Error("approval-wait state must not be read");
      return undefined;
    },
  };
  const result = await selectRunOnceWorkflow(
    [issue(272, ["agent-ready", "spec-review"]), issue(327, ["agent-ready"])],
    approvalConfig,
    state as never,
  );
  assert.equal(result.kind, "fresh-planning");
  if (result.kind === "fresh-planning") assert.equal(result.issue.number, 327);
  assert.deepEqual(reads, [327]);

  const fresh = await selectRunOnceWorkflow(
    [issue(272, ["agent-ready", "plan-review"]), issue(327, ["agent-ready"])],
    approvalConfig,
    { path: () => "state", read: async () => undefined } as never,
  );
  assert.equal(fresh.kind, "fresh-planning");
  if (fresh.kind === "fresh-planning") assert.equal(fresh.issue.number, 327);
});

test("keeps explicit approval-wait legacy resume pinned for its approval diagnostic", async () => {
  const runStateDir = await mkdtemp(join(tmpdir(), "planning-selection-"));
  try {
    await writeRunState(runStateDir, {
      issueNumber: 272,
      title: "Issue 272",
      status: "finished",
      specPath: "docs/specs/issue-272.md",
      branch: "agent/issue-272",
    });
    const selected = await selectRunOnceWorkflow(
      [issue(272, ["agent-ready", "spec-review"]), issue(327, ["agent-ready"])],
      { ...approvalConfig, runStateDir, issueNumber: 272 },
      { path: () => "state", read: async () => undefined } as never,
    );
    assert.equal(selected.kind, "legacy");
    if (selected.kind === "legacy") assert.equal(selected.issue.number, 272);
  } finally {
    await rm(runStateDir, { recursive: true, force: true });
  }
});
