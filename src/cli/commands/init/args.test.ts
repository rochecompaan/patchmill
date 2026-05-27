import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

test("parseArgs defaults to creating config", () => {
  assert.deepEqual(parseArgs([], "/repo"), {
    repoRoot: "/repo",
    showHelp: false,
  });
});

test("parseArgs recognizes help", () => {
  assert.deepEqual(parseArgs(["--help"], "/repo"), {
    repoRoot: "/repo",
    showHelp: true,
  });
  assert.deepEqual(parseArgs(["-h"], "/repo"), {
    repoRoot: "/repo",
    showHelp: true,
  });
});

test("parseArgs rejects force in v1", () => {
  assert.throws(
    () => parseArgs(["--force"], "/repo"),
    /Unknown argument: --force/,
  );
});

test("parseArgs rejects unknown arguments", () => {
  assert.throws(
    () => parseArgs(["--json"], "/repo"),
    /Unknown argument: --json/,
  );
});
