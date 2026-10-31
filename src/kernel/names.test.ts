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

test("artifact file names use the local date, issue, title, and kind", () => {
  assert.equal(
    artifactFileName("spec", date, 5, "Fix: login crashes!"),
    "2026-10-15-issue-5-fix-login-crashes-design.md",
  );
  assert.equal(
    artifactFileName("plan", date, 5, "Fix: login crashes!"),
    "2026-10-15-issue-5-fix-login-crashes-plan.md",
  );
  assert.equal(
    artifactFileName("plan", date, 5, "???"),
    "2026-10-15-issue-5-plan.md",
  );
});

test("artifact recognition matches issue and kind across dates and titles", () => {
  for (const kind of ["spec", "plan"] as const) {
    for (const title of ["Old title", "???"])
      assert.equal(
        isArtifactFile(
          kind,
          5,
          artifactFileName(kind, new Date(2024, 0, 2), 5, title),
        ),
        true,
      );
    assert.equal(
      isArtifactFile(kind, 5, artifactFileName(kind, date, 50, "Login")),
      false,
    );
    assert.equal(isArtifactFile(kind, 5, `issue-5-login-${kind}.md`), false);
  }
});

test("spec and plan names never match each other, whatever the title", () => {
  for (const title of ["Add design", "Add better design", "Add plan", "???"]) {
    assert.equal(
      isArtifactFile("plan", 9, artifactFileName("spec", date, 9, title)),
      false,
    );
    assert.equal(
      isArtifactFile("spec", 9, artifactFileName("plan", date, 9, title)),
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
  assert.ok(artifactFileName("spec", year999, 5, "Login").startsWith("0999-"));
  assert.ok(artifactFileName("plan", year999, 5, "Login").startsWith("0999-"));
  assert.ok(newRunId(year999).startsWith("09991015-"));
});

test("runDirectory joins the run root, issue, and identifier", () => {
  assert.equal(
    runDirectory(".patchmill/runs", 5, "x"),
    ".patchmill/runs/issue-5/x",
  );
});
