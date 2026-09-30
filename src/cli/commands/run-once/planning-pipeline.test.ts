import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlanningIssueLockConflictError } from "../../../workflow/planning-issue-lock.ts";
import { PlanningStateValidationError } from "../../../workflow/planning-state.ts";
import {
  mapPlanningOutcome,
  planningIssueNeedsClaim,
  runPlanningIssue,
} from "./planning-pipeline.ts";
import { AgentIssueConsoleProgressReporter } from "./console-progress.ts";
import {
  JsonlProgressReporter,
  compositeProgressReporter,
} from "./progress.ts";

test("normalizes an unannotated planning agent blocker at the public boundary", () => {
  const result = mapPlanningOutcome(
    { number: 189, title: "Example", state: "open", labels: [] } as never,
    {
      kind: "blocked",
      state: { phases: [] },
      result: {
        status: "blocked",
        reason: "Need an API decision",
        questions: ["Which API?"],
        commits: [],
        validation: ["npm test failed"],
      },
    } as never,
    "agent-ready",
  );
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.publicFailure.reason, "agent-blocked");
    if (result.publicFailure.reason === "agent-blocked")
      assert.deepEqual(result.publicFailure.diagnosticContext, {
        issueNumber: 189,
        status: "blocked",
        reportedReason: "Need an API decision",
        questions: ["Which API?"],
        evidence: ["npm test failed"],
      });
  }
});

test("does not reclaim an issue after its done-label checkpoint", () => {
  assert.equal(
    planningIssueNeedsClaim({
      issue: {
        number: 189,
        title: "Example",
        state: "open",
        labels: ["agent-done"],
      } as never,
      fresh: false,
      state: {
        phases: [
          {
            kind: "implementation",
            status: "pull-request-open",
            finish: { doneLabelApplied: true },
          },
        ],
      } as never,
      labels: {
        ready: "agent-ready",
        inProgress: "agent-in-progress",
        done: "agent-done",
      },
    }),
    false,
  );
});

test("does not reclaim a done-labeled finish awaiting its final checkpoint", () => {
  assert.equal(
    planningIssueNeedsClaim({
      issue: {
        number: 189,
        title: "Example",
        state: "open",
        labels: ["agent-done"],
      } as never,
      fresh: false,
      state: {
        phases: [
          {
            kind: "implementation",
            status: "pull-request-open",
            workspace: { cleanup: { state: "removed" } },
            finish: {
              visualEvidenceValidated: true,
              handoffCommentPosted: true,
              cleanupHookCompleted: true,
              doneLabelEnsured: true,
            },
          },
        ],
      } as never,
      labels: {
        ready: "agent-ready",
        inProgress: "agent-in-progress",
        done: "agent-done",
      },
    }),
    false,
  );
});

test("returns stopped without mutation for an active planning lock", async () => {
  let mutated = false;
  const result = await runPlanningIssue({
    issue: {
      number: 189,
      title: "Example",
      state: "open",
      labels: [],
    } as never,
    state: { runId: "123e4567-e89b-42d3-a456-426614174000" } as never,
    expectedStatePresence: "present",
    runStateDir: "/tmp/state",
    stateStore: {} as never,
    readIssue: async () => {
      throw new Error("unreachable");
    },
    readLegacy: async () => false,
    mutate: async () => {
      mutated = true;
    },
    coordinate: async () => {
      throw new Error("unreachable");
    },
    acquire: async () => {
      throw new PlanningIssueLockConflictError({
        classification: "active",
        path: "lock",
        fingerprint: "",
      });
    },
  });
  assert.equal(result.status, "stopped");
  assert.equal(mutated, false);
});

test("reports stale-lock takeover before post-lock reads", async () => {
  const calls: string[] = [];
  const result = await runPlanningIssue({
    issue: {
      number: 189,
      title: "Example",
      state: "open",
      labels: [],
    } as never,
    config: {} as never,
    state: { runId: "123e4567-e89b-42d3-a456-426614174000" } as never,
    expectedStatePresence: "present",
    runStateDir: "/tmp/state",
    stateStore: {
      read: async () => {
        calls.push("state");
        return undefined;
      },
    },
    readIssue: async () => {
      calls.push("issue");
      return {
        number: 189,
        title: "Example",
        state: "open",
        labels: [],
      } as never;
    },
    readLegacy: async () => {
      calls.push("legacy");
      return undefined;
    },
    mutate: async () => [],
    coordinate: async () => {
      throw new Error("unreachable");
    },
    acquire: async () =>
      ({
        path: "/tmp/lock",
        record: { runId: "123e4567-e89b-42d3-a456-426614174000" },
        takeover: {
          owner: {
            runId: "123e4567-e89b-42d3-a456-426614174001",
            hostname: "host.test",
            pid: 1234,
            acquiredAt: "2026-09-07T12:00:00.000Z",
          },
          fingerprint: "a".repeat(64),
          sourcePath: "/tmp/stale.lock",
          archivePath: "/tmp/archive.lock",
        },
      }) as never,
    release: async () => {},
    now: () => new Date("2026-09-08T12:00:00.000Z"),
    progress: {
      event: async (event) => {
        calls.push(event.message);
        assert.equal(JSON.stringify(event).includes("serialized"), false);
      },
    },
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(calls, [
    "stale planning lock reclaimed",
    "issue",
    "state",
    "legacy",
  ]);
});

test("reports a retry takeover through console and JSONL before authoritative revalidation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "planning-pipeline-"));
  const logPath = join(directory, "progress.jsonl");
  const calls: string[] = [];
  const events: unknown[] = [];
  const lines: string[] = [];
  const initialRunId = "123e4567-e89b-42d3-a456-426614174000";
  const authoritativeRunId = "123e4567-e89b-42d3-a456-426614174001";
  const staleBytes = "exact stale bytes must never reach progress output";
  const authoritativeState = {
    issueNumber: 189,
    runId: authoritativeRunId,
    phases: [{ status: "pending" }],
  } as never;
  const progress = compositeProgressReporter([
    {
      event: async (event) => {
        events.push(event);
      },
    },
    new AgentIssueConsoleProgressReporter({
      writeLine: (line) => lines.push(line),
      startedAt: new Date("2026-09-08T12:00:00.000Z"),
    }),
    new JsonlProgressReporter(logPath),
  ]);
  let acquired = 0;
  try {
    const result = await runPlanningIssue({
      issue: {
        number: 189,
        title: "Example",
        state: "open",
        labels: [],
      } as never,
      config: {} as never,
      state: {
        issueNumber: 189,
        runId: initialRunId,
        phases: [{ status: "pending" }],
      } as never,
      expectedStatePresence: "absent",
      runStateDir: directory,
      stateStore: {
        read: async () => {
          calls.push("state");
          return authoritativeState;
        },
      },
      readIssue: async () => {
        calls.push("issue");
        return {
          number: 189,
          title: "Example",
          state: "open",
          labels: [],
        } as never;
      },
      readLegacy: async () => {
        calls.push("legacy");
        return undefined;
      },
      mutate: async () => {
        calls.push("mutate");
        return [];
      },
      coordinate: async () => {
        calls.push("coordinate");
        return {} as never;
      },
      acquire: async (_runStateDir, input) => {
        acquired += 1;
        calls.push(`acquire:${input.runId}`);
        return {
          path: "/tmp/lock",
          record: { runId: input.runId },
          ...(acquired === 1
            ? {}
            : {
                takeover: {
                  owner: {
                    runId: initialRunId,
                    hostname: "host.test",
                    pid: 1234,
                    acquiredAt: "2026-09-07T12:00:00.000Z",
                  },
                  fingerprint: "a".repeat(64),
                  sourcePath: "/tmp/stale.lock",
                  archivePath: "/tmp/archive/owner.record",
                },
              }),
        } as never;
      },
      release: async (lock) => {
        calls.push(`release:${lock.record.runId}`);
      },
      now: () => new Date("2026-09-08T12:00:00.000Z"),
      progress: {
        event: async (event) => {
          calls.push(event.message);
          await progress.event(event);
        },
      },
    });

    assert.equal(result.status, "coordinated");
    assert.deepEqual(calls, [
      `acquire:${initialRunId}`,
      "issue",
      "state",
      "legacy",
      `release:${initialRunId}`,
      `acquire:${authoritativeRunId}`,
      "stale planning lock reclaimed",
      "issue",
      "state",
      "legacy",
      "mutate",
      "coordinate",
      `release:${authoritativeRunId}`,
    ]);
    const warning = events.filter(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { message?: string }).message ===
          "stale planning lock reclaimed",
    );
    assert.deepEqual(warning, [
      {
        time: "2026-09-08T12:00:00.000Z",
        level: "warning",
        stage: "planning-lock",
        message: "stale planning lock reclaimed",
        consoleMessage:
          "⚠ reclaimed stale planning lock for issue #189; archived evidence at /tmp/archive/owner.record",
        issueNumber: 189,
        data: {
          kind: "planning-lock-takeover",
          oldRunId: initialRunId,
          hostname: "host.test",
          pid: 1234,
          acquiredAt: "2026-09-07T12:00:00.000Z",
          fingerprint: "a".repeat(64),
          sourcePath: "/tmp/stale.lock",
          archivePath: "/tmp/archive/owner.record",
        },
      },
    ]);
    assert.deepEqual(lines, [
      "⚠ reclaimed stale planning lock for issue #189; archived evidence at /tmp/archive/owner.record",
    ]);
    const jsonl = await readFile(logPath, "utf8");
    assert.equal(jsonl.includes("consoleMessage"), false);
    assert.equal(jsonl.includes(staleBytes), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("maps malformed post-lock planning state to a no-mutation blocker", async () => {
  let mutated = false;
  const result = await runPlanningIssue({
    issue: {
      number: 189,
      title: "Example",
      state: "open",
      labels: ["agent-in-progress"],
    } as never,
    state: { runId: "123e4567-e89b-42d3-a456-426614174000" } as never,
    expectedStatePresence: "present",
    runStateDir: "/tmp/state",
    stateStore: {
      read: async () => {
        throw new PlanningStateValidationError(
          "invalid-json",
          "$",
          "/tmp/state/issue-189.json",
        );
      },
    },
    readIssue: async () =>
      ({
        number: 189,
        title: "Example",
        state: "open",
        labels: ["agent-in-progress"],
      }) as never,
    readLegacy: async () => undefined,
    mutate: async () => {
      mutated = true;
      return [];
    },
    coordinate: async () => {
      throw new Error("unreachable");
    },
    acquire: async () =>
      ({ record: { runId: "123e4567-e89b-42d3-a456-426614174000" } }) as never,
    release: async () => {},
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.result.reason, "planning-state-invalid");
    assert.deepEqual(result.result.publicFailure, {
      reason: "planning-state-invalid",
      diagnosticContext: {
        issueNumber: 189,
        status: "blocked",
        statePath: "/tmp/state/issue-189.json",
        validation: "invalid-json at $",
      },
    });
  }
  assert.equal(mutated, false);
});

test("blocks active planning state that conflicts with blocked legacy recovery after locking", async () => {
  let mutated = false;
  let coordinated = false;
  const active = {
    runId: "123e4567-e89b-42d3-a456-426614174000",
    issueNumber: 189,
    phases: [{ status: "pending" }],
  } as never;
  const result = await runPlanningIssue({
    issue: {
      number: 189,
      title: "Example",
      state: "open",
      labels: ["agent-in-progress"],
    } as never,
    config: {} as never,
    state: active,
    expectedStatePresence: "present",
    runStateDir: "/tmp/state",
    stateStore: { read: async () => active, initialize: async () => {} },
    readIssue: async () =>
      ({
        number: 189,
        title: "Example",
        state: "open",
        labels: ["agent-in-progress"],
      }) as never,
    readLegacy: async () =>
      ({ status: "blocked", lastError: "needs input" }) as never,
    mutate: async () => {
      mutated = true;
      return [];
    },
    coordinate: async () => {
      coordinated = true;
      return {} as never;
    },
    acquire: async () =>
      ({ record: { runId: "123e4567-e89b-42d3-a456-426614174000" } }) as never,
    release: async () => {},
  });
  assert.equal(result.status, "blocked");
  assert.equal(mutated, false);
  assert.equal(coordinated, false);
});

test("blocks an active selection whose authoritative state disappears after locking", async () => {
  let initialized = false;
  let mutated = false;
  let coordinated = false;
  const result = await runPlanningIssue({
    issue: {
      number: 189,
      title: "Example",
      state: "open",
      labels: ["agent-in-progress"],
    } as never,
    state: {
      runId: "123e4567-e89b-42d3-a456-426614174000",
      phases: [{ status: "pending" }],
    } as never,
    expectedStatePresence: "present",
    runStateDir: "/tmp/state",
    stateStore: {
      read: async () => undefined,
      initialize: async () => {
        initialized = true;
      },
    },
    readIssue: async () =>
      ({
        number: 189,
        title: "Example",
        state: "open",
        labels: ["agent-in-progress"],
      }) as never,
    readLegacy: async () => undefined,
    mutate: async () => {
      mutated = true;
      return [];
    },
    coordinate: async () => {
      coordinated = true;
      return {} as never;
    },
    acquire: async () =>
      ({ record: { runId: "123e4567-e89b-42d3-a456-426614174000" } }) as never,
    release: async () => {},
  });
  assert.equal(result.status, "blocked");
  assert.equal(initialized, false);
  assert.equal(mutated, false);
  assert.equal(coordinated, false);
});
