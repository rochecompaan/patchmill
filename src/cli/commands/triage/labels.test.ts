import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import {
  DEFAULT_TRIAGE_POLICY,
  REQUIRED_LABELS,
  missingLabelDefinitions,
  planLabelChange,
} from "./labels.ts";

const { blocked, done, inProgress, needsInfo, ready, unsuitable } =
  DEFAULT_PATCHMILL_CONFIG.labels;

test("DEFAULT_TRIAGE_POLICY includes required automation labels", () => {
  assert.deepEqual(
    DEFAULT_TRIAGE_POLICY.primaryBuckets.map((bucket) => bucket.status),
    ["agent-ready", "needs-info", "agent-unsuitable"],
  );
  assert.deepEqual(
    DEFAULT_TRIAGE_POLICY.primaryBuckets.map((bucket) => bucket.label),
    [ready, needsInfo, unsuitable],
  );

  for (const name of [
    ready,
    needsInfo,
    unsuitable,
    inProgress,
    done,
    blocked,
  ]) {
    assert.ok(REQUIRED_LABELS.some((label) => label.name === name));
  }
});

test("missingLabelDefinitions returns labels absent from Forgejo", () => {
  const missing = missingLabelDefinitions(["bug", ready]);

  assert.ok(missing.some((label) => label.name === needsInfo));
  assert.equal(
    missing.some((label) => label.name === "bug"),
    false,
  );
  assert.equal(
    missing.some((label) => label.name === ready),
    false,
  );
});

test("planLabelChange computes additions and removals", () => {
  const change = planLabelChange(7, ["bug", "old", needsInfo], ["bug", ready]);

  assert.deepEqual(change, {
    issueNumber: 7,
    oldLabels: [needsInfo, "bug", "old"].sort((a, b) => a.localeCompare(b)),
    newLabels: [ready, "bug"].sort((a, b) => a.localeCompare(b)),
    addLabels: [ready],
    removeLabels: ["old", needsInfo],
  });
});
