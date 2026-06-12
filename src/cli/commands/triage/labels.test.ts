import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import {
  DEFAULT_TRIAGE_POLICY,
  missingLabelDefinitions,
  planLabelChange,
} from "./labels.ts";

const { blocked, done, inProgress, needsInfo, ready, unsuitable } =
  DEFAULT_PATCHMILL_CONFIG.labels;

test("DEFAULT_TRIAGE_POLICY includes required automation labels", () => {
  assert.equal(DEFAULT_TRIAGE_POLICY.labels.ready, ready);
  assert.equal(DEFAULT_TRIAGE_POLICY.labels.needsInfo, needsInfo);
  assert.equal(DEFAULT_TRIAGE_POLICY.labels.unsuitable, unsuitable);
  assert.equal(DEFAULT_TRIAGE_POLICY.labels.inProgress, inProgress);
  assert.equal(DEFAULT_TRIAGE_POLICY.labels.done, done);
  assert.equal(DEFAULT_TRIAGE_POLICY.labels.blocked, blocked);

  for (const name of [ready, needsInfo, unsuitable]) {
    assert.ok(
      DEFAULT_TRIAGE_POLICY.allowedLabels.some((label) => label.name === name),
    );
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

test("missingLabelDefinitions uses the default Patchmill label catalog", () => {
  const missing = missingLabelDefinitions([ready, "bug"]);

  assert.ok(missing.some((label) => label.name === "needs-info"));
  assert.ok(missing.some((label) => label.name === "spec-review"));
  assert.ok(missing.some((label) => label.name === "spec-approved"));
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

test("planLabelChange de-duplicates labels and preserves add/remove order", () => {
  const change = planLabelChange(
    8,
    ["bug", needsInfo, "old", needsInfo, "stale"],
    ["bug", ready, ready, "blocked", ready],
  );

  assert.deepEqual(change.oldLabels, ["bug", needsInfo, "old", "stale"]);
  assert.deepEqual(change.newLabels, [ready, "blocked", "bug"]);
  assert.deepEqual(change.addLabels, [ready, "blocked"]);
  assert.deepEqual(change.removeLabels, [needsInfo, "old", "stale"]);
});
