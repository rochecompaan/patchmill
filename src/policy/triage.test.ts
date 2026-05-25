import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../config/defaults.ts";
import { createTriagePolicy } from "./triage.ts";

test("createTriagePolicy uses configured labels, default stateMap, and allowed labels", () => {
  const policy = createTriagePolicy({
    ...DEFAULT_PATCHMILL_CONFIG.labels,
    ready: "ready-for-bots",
    needsInfo: "needs-clarification",
    unsuitable: "manual-only",
    inProgress: "claimed",
    done: "done-by-bot",
    blocked: "waiting",
    types: ["incident"],
    priorities: ["priority:p1", "priority:p2"],
  });

  assert.deepEqual(policy.labels, {
    ready: "ready-for-bots",
    needsInfo: "needs-clarification",
    unsuitable: "manual-only",
    inProgress: "claimed",
    done: "done-by-bot",
    blocked: "waiting",
    types: ["incident"],
    priorities: ["priority:p1", "priority:p2"],
  });
  assert.deepEqual(policy.stateMap, {
    "ready-for-bots": "agent-ready",
    "needs-clarification": "needs-info",
    "manual-only": "agent-unsuitable",
  });
  assert.ok(policy.allowedLabels.some((label) => label.name === "incident"));
  assert.ok(
    policy.allowedLabels.some((label) => label.name === "ready-for-bots"),
  );
  assert.ok(policy.allowedLabels.some((label) => label.name === "claimed"));
  assert.deepEqual(policy.excludedLabels, [
    "ready-for-bots",
    "needs-clarification",
    "manual-only",
    "claimed",
    "done-by-bot",
    "waiting",
  ]);
  assert.deepEqual(policy.runOnceSelection, {
    readyLabel: "ready-for-bots",
    excludedLabels: [
      "needs-clarification",
      "manual-only",
      "claimed",
      "done-by-bot",
      "waiting",
    ],
    priorityOrder: ["priority:p1", "priority:p2"],
  });
});

test("createTriagePolicy clones supplied triage state maps for runtime and run-once selection", () => {
  const stateMap = {
    "agent-ready": "agent-ready",
    "needs-info": "needs-info",
    "agent-unsuitable": "agent-unsuitable",
    deferred: "needs-info",
  };

  const policy = createTriagePolicy(DEFAULT_PATCHMILL_CONFIG.labels, {
    stateMap,
  });

  assert.notEqual(policy.stateMap, stateMap);
  assert.deepEqual(policy.stateMap, stateMap);
  assert.deepEqual(policy.runOnceSelection, {
    readyLabel: "agent-ready",
    excludedLabels: [
      "needs-info",
      "agent-unsuitable",
      "in-progress",
      "agent-done",
      "blocked",
      "deferred",
    ],
    priorityOrder: [...DEFAULT_PATCHMILL_CONFIG.labels.priorities],
  });
});
