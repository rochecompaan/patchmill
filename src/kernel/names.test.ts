import assert from "node:assert/strict";
import { test } from "node:test";
import {
  branchName,
  isIssueBranch,
  isPlanFile,
  isSpecFile,
  newRunId,
  planFileName,
  runDirectory,
  slugify,
  specFileName,
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

test("specFileName uses the local date and title slug", () => {
  assert.equal(
    specFileName(date, 5, "Login"),
    "2026-10-15-issue-5-login-design.md",
  );
});

test("isSpecFile recognizes matching names and rejects other issue numbers or shapes", () => {
  assert.equal(isSpecFile(5, "2026-10-15-issue-5-login-design.md"), true);
  assert.equal(isSpecFile(5, "2026-10-15-issue-50-login-design.md"), false);
  assert.equal(isSpecFile(5, "issue-5-design.md"), false);
});

test("isSpecFile recognizes a spec file with an empty title slug", () => {
  assert.equal(isSpecFile(7, specFileName(date, 7, "???")), true);
});

test("planFileName uses the local date and title slug", () => {
  assert.equal(planFileName(date, 5, "Login"), "2026-10-15-issue-5-login.md");
});

test("isPlanFile recognizes matching names and rejects another issue number", () => {
  assert.equal(isPlanFile(5, "2026-10-15-issue-5-login.md"), true);
  assert.equal(isPlanFile(5, "2026-10-15-issue-50-login.md"), false);
});

test("isPlanFile recognizes a plan file with an empty title slug", () => {
  assert.equal(isPlanFile(7, planFileName(date, 7, "???")), true);
});

test("newRunId uses the local timestamp and a four-character hex suffix", () => {
  const runId = newRunId(date);
  assert.match(runId, /^\d{8}-\d{6}-[0-9a-f]{4}$/);
  assert.equal(runId.slice(0, 15), "20261015-130405");
});

test("runDirectory joins the run root, issue, and identifier", () => {
  assert.equal(
    runDirectory(".patchmill/runs", 5, "x"),
    ".patchmill/runs/issue-5/x",
  );
});
