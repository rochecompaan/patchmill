import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

test("parseArgs defaults to running checks", () => {
  assert.deepEqual(parseArgs([], "/repo"), {
    repoRoot: "/repo",
    showHelp: false,
    quiet: false,
    fix: false,
    yes: false,
  });
});

test("parseArgs recognizes help", () => {
  assert.equal(parseArgs(["--help"], "/repo").showHelp, true);
  assert.equal(parseArgs(["-h"], "/repo").showHelp, true);
});

test("parseArgs recognizes quiet", () => {
  assert.deepEqual(parseArgs(["--quiet"], "/repo"), {
    repoRoot: "/repo",
    showHelp: false,
    quiet: true,
    fix: false,
    yes: false,
  });
});

test("parseArgs recognizes fix", () => {
  assert.deepEqual(parseArgs(["--fix"], "/repo"), {
    repoRoot: "/repo",
    showHelp: false,
    quiet: false,
    fix: true,
    yes: false,
  });
});

test("parseArgs recognizes fix with yes", () => {
  assert.deepEqual(parseArgs(["--fix", "--yes"], "/repo"), {
    repoRoot: "/repo",
    showHelp: false,
    quiet: false,
    fix: true,
    yes: true,
  });
});

test("parseArgs rejects yes without fix", () => {
  assert.throws(
    () => parseArgs(["--yes"], "/repo"),
    /--yes can only be used with --fix/,
  );
});
