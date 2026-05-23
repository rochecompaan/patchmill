import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PATCHMILL_CONFIG } from "../../src/config/defaults.ts";
import {
  ALLOWED_LABEL_NAMES,
  PRIMARY_BUCKETS,
  REQUIRED_LABELS,
  TRIAGE_ALLOWED_LABEL_NAMES,
  missingLabelDefinitions,
  planLabelChange,
} from "./labels.ts";

const { blocked, done, inProgress, needsInfo, ready, unsuitable } = DEFAULT_PATCHMILL_CONFIG.labels;

test("label vocabulary includes buckets, automation, type labels, and priority labels", () => {
  assert.deepEqual(PRIMARY_BUCKETS, [ready, needsInfo, unsuitable]);
  assert.equal(PRIMARY_BUCKETS.some((label) => label === inProgress), false);
  assert.equal(PRIMARY_BUCKETS.some((label) => label === done), false);
  assert.ok(ALLOWED_LABEL_NAMES.has(ready));
  assert.ok(ALLOWED_LABEL_NAMES.has(needsInfo));
  assert.ok(ALLOWED_LABEL_NAMES.has(inProgress));
  assert.ok(ALLOWED_LABEL_NAMES.has(done));
  assert.ok(ALLOWED_LABEL_NAMES.has(blocked));
  assert.equal(TRIAGE_ALLOWED_LABEL_NAMES.has(inProgress), false);
  assert.equal(TRIAGE_ALLOWED_LABEL_NAMES.has(done), false);
  assert.equal(TRIAGE_ALLOWED_LABEL_NAMES.has(blocked), false);
  assert.equal(ALLOWED_LABEL_NAMES.has("needs-plan"), false);
  assert.ok(ALLOWED_LABEL_NAMES.has("bug"));
  assert.ok(ALLOWED_LABEL_NAMES.has("priority:critical"));
  const inProgressLabel = REQUIRED_LABELS.find((label) => label.name === inProgress);
  assert.ok(inProgressLabel);
  assert.match(inProgressLabel.description, /currently being processed by automation/i);
  const doneLabel = REQUIRED_LABELS.find((label) => label.name === done);
  assert.ok(doneLabel);
  assert.match(doneLabel.description, /completed by automation/i);
  const blockedLabel = REQUIRED_LABELS.find((label) => label.name === blocked);
  assert.ok(blockedLabel);
  assert.match(blockedLabel.description, /blocked by another issue or dependency/i);
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
