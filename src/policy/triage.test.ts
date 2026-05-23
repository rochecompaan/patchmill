import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../config/defaults.ts";
import { createTriagePolicy, labelForPrimaryBucket } from "./triage.ts";

test("createTriagePolicy keeps default bucket statuses while mapping configured labels", () => {
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

  assert.deepEqual(policy.primaryBuckets, [
    { status: "agent-ready", label: "ready-for-bots" },
    { status: "needs-info", label: "needs-clarification" },
    { status: "agent-unsuitable", label: "manual-only" },
  ]);
  assert.equal(labelForPrimaryBucket(policy, "agent-ready"), "ready-for-bots");
  assert.equal(labelForPrimaryBucket(policy, "needs-info"), "needs-clarification");
  assert.equal(labelForPrimaryBucket(policy, "agent-unsuitable"), "manual-only");
  assert.ok(policy.allowedLabels.some((label) => label.name === "incident"));
  assert.ok(policy.triageAllowedLabels.some((label) => label.name === "ready-for-bots"));
  assert.equal(policy.triageAllowedLabels.some((label) => label.name === "claimed"), false);
  assert.deepEqual(policy.runOnceSelection, {
    readyLabel: "ready-for-bots",
    excludedLabels: ["needs-clarification", "manual-only", "claimed", "done-by-bot", "waiting"],
    priorityOrder: ["priority:p1", "priority:p2"],
  });
});

test("createTriagePolicy exposes shared confidence, ambiguity, and comment behavior defaults", () => {
  const policy = createTriagePolicy(DEFAULT_PATCHMILL_CONFIG.labels);

  assert.deepEqual(policy.confidenceValues, ["low", "medium", "high"]);
  assert.match(policy.ambiguityRuleText, /Any ambiguity in issue intent/);
  assert.equal(policy.needsInfo.commentBehavior, "generated-from-rationale-and-questions");
});
