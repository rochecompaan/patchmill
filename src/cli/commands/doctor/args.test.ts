import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

test("parseArgs defaults to running checks", () => {
  assert.deepEqual(parseArgs([], "/repo"), {
    repoRoot: "/repo",
    showHelp: false,
    quiet: false,
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
  });
});

test("parseArgs rejects fix mode in v1", () => {
  assert.throws(() => parseArgs(["--fix"], "/repo"), /Unknown argument: --fix/);
});
