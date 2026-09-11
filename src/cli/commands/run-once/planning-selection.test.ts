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
