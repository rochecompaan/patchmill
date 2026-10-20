import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artifactFileName,
  branchName,
  isArtifactFile,
  isIssueBranch,
  newRunId,
  runDirectory,
  slugify,
  worktreeDirName,
} from "./names.ts";

const date = new Date(2026, 9, 15, 13, 4, 5);

test("slugify normalizes separator runs", () => {
  assert.equal(slugify("Fix: login  crashes!"), "fix-login-crashes");
});

test("slugify removes a hyphen exposed by the 48-character limit", () => {
  assert.equal(
    slugify("abcdefg ".repeat(8)),
    "abcdefg-abcdefg-abcdefg-abcdefg-abcdefg-abcdefg",
  );
});

test("slugify returns empty for titles without ASCII alphanumerics", () => {
  assert.equal(slugify("???"), "");
});

test("branchName omits the slug separator for an empty slug", () => {
  assert.equal(branchName(7, "???"), "agent/issue-7");
});

test("isIssueBranch requires the complete issue number", () => {
  assert.equal(isIssueBranch(1, "agent/issue-12-foo"), false);
  assert.equal(isIssueBranch(1, "agent/issue-1"), true);
});

test("worktreeDirName replaces every branch separator", () => {
  assert.equal(worktreeDirName("agent/issue-5-login"), "agent-issue-5-login");
  assert.equal(
    worktreeDirName("agent/issue-5/login/path"),
    "agent-issue-5-login-path",
  );
});

test("artifact file names use the local date, issue number, and kind only", () => {
  assert.equal(
    artifactFileName("spec", date, 5),
    "2026-10-15-issue-5-design.md",
  );
  assert.equal(artifactFileName("plan", date, 5), "2026-10-15-issue-5-plan.md");
});

test("artifact recognition matches issue and kind across creation dates", () => {
  for (const kind of ["spec", "plan"] as const) {
    assert.equal(
      isArtifactFile(kind, 5, artifactFileName(kind, new Date(2024, 0, 2), 5)),
      true,
    );
    assert.equal(
      isArtifactFile(kind, 5, artifactFileName(kind, date, 50)),
      false,
    );
    assert.equal(isArtifactFile(kind, 5, `issue-5-${kind}.md`), false);
  }
});

test("spec and plan names never match each other or title-derived names", () => {
  assert.equal(
    isArtifactFile("plan", 5, artifactFileName("spec", date, 5)),
    false,
  );
  assert.equal(
    isArtifactFile("spec", 5, artifactFileName("plan", date, 5)),
    false,
  );
  for (const kind of ["spec", "plan"] as const) {
    assert.equal(
      isArtifactFile(kind, 9, "2026-10-14-issue-9-add-design.md"),
      false,
    );
    assert.equal(
      isArtifactFile(kind, 9, "2026-10-14-issue-9-add-plan.md"),
      false,
    );
  }
});

test("newRunId uses the local timestamp and a four-character hex suffix", () => {
  const runId = newRunId(date);
  assert.match(runId, /^\d{8}-\d{6}-[0-9a-f]{4}$/);
  assert.equal(runId.slice(0, 15), "20261015-130405");
});

test("artifact names and run IDs pad local years below 1000", () => {
  const year999 = new Date(2026, 9, 15, 13, 4, 5);
  year999.setFullYear(999);
  assert.ok(artifactFileName("spec", year999, 5).startsWith("0999-"));
  assert.ok(artifactFileName("plan", year999, 5).startsWith("0999-"));
  assert.ok(newRunId(year999).startsWith("09991015-"));
});

test("runDirectory joins the run root, issue, and identifier", () => {
  assert.equal(
    runDirectory(".patchmill/runs", 5, "x"),
    ".patchmill/runs/issue-5/x",
  );
});
