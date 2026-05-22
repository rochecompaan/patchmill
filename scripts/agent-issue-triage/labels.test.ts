import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_LABEL_NAMES,
  PRIMARY_BUCKETS,
  REQUIRED_LABELS,
  TRIAGE_ALLOWED_LABEL_NAMES,
  missingLabelDefinitions,
  planLabelChange,
} from "./labels.ts";

test("label vocabulary includes buckets, automation, type labels, and priority labels", () => {
  assert.deepEqual(PRIMARY_BUCKETS, ["agent-ready", "needs-info", "agent-unsuitable"]);
  assert.equal(PRIMARY_BUCKETS.some((label) => label === "in-progress"), false);
  assert.equal(PRIMARY_BUCKETS.some((label) => label === "agent-done"), false);
  assert.ok(ALLOWED_LABEL_NAMES.has("agent-ready"));
  assert.ok(ALLOWED_LABEL_NAMES.has("needs-info"));
  assert.ok(ALLOWED_LABEL_NAMES.has("in-progress"));
  assert.ok(ALLOWED_LABEL_NAMES.has("agent-done"));
  assert.ok(ALLOWED_LABEL_NAMES.has("blocked"));
  assert.equal(TRIAGE_ALLOWED_LABEL_NAMES.has("in-progress"), false);
  assert.equal(TRIAGE_ALLOWED_LABEL_NAMES.has("agent-done"), false);
  assert.equal(TRIAGE_ALLOWED_LABEL_NAMES.has("blocked"), false);
  assert.equal(ALLOWED_LABEL_NAMES.has("needs-plan"), false);
  assert.ok(ALLOWED_LABEL_NAMES.has("bug"));
  assert.ok(ALLOWED_LABEL_NAMES.has("priority:critical"));
  const inProgress = REQUIRED_LABELS.find((label) => label.name === "in-progress");
  assert.ok(inProgress);
  assert.match(inProgress.description, /currently being processed by automation/i);
  const agentDone = REQUIRED_LABELS.find((label) => label.name === "agent-done");
  assert.ok(agentDone);
  assert.match(agentDone.description, /completed by automation/i);
  const blocked = REQUIRED_LABELS.find((label) => label.name === "blocked");
  assert.ok(blocked);
  assert.match(blocked.description, /blocked by another issue or dependency/i);
  assert.equal(REQUIRED_LABELS.some((label) => label.name === "agent-easy"), false);
  assert.equal(REQUIRED_LABELS.some((label) => label.name === "agent-mechanical"), false);
  assert.equal(REQUIRED_LABELS.some((label) => label.name === "agent-needs-human-decision"), false);
  assert.equal(REQUIRED_LABELS.some((label) => label.name === "agent-needs-info"), false);
  assert.equal(REQUIRED_LABELS.some((label) => label.name === "agent-needs-plan"), false);
  assert.equal(REQUIRED_LABELS.some((label) => label.name === "needs-plan"), false);
});

test("label vocabulary excludes area, risk, and size labels", () => {
  assert.equal(ALLOWED_LABEL_NAMES.has("area:mobile"), false);
  assert.equal(ALLOWED_LABEL_NAMES.has("risk:low"), false);
  assert.equal(ALLOWED_LABEL_NAMES.has("size:small"), false);
  assert.equal(REQUIRED_LABELS.some((label) => /^(area|risk|size):/.test(label.name)), false);
});

test("missingLabelDefinitions returns labels absent from Forgejo", () => {
  const missing = missingLabelDefinitions(["bug", "agent-ready"]);

  assert.ok(missing.some((label) => label.name === "needs-info"));
  assert.equal(missing.some((label) => label.name === "bug"), false);
});

test("planLabelChange computes additions and removals", () => {
  const change = planLabelChange(7, ["bug", "old", "agent-needs-info"], ["bug", "agent-ready"]);

  assert.deepEqual(change.addLabels, ["agent-ready"]);
  assert.deepEqual(change.removeLabels, ["old", "agent-needs-info"]);
});
