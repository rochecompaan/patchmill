import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

const expectedDefault = {
  repoRoot: "/repo",
  showHelp: false,
  skills: { mode: "project" },
};

test("parseArgs defaults to creating config", () => {
  assert.deepEqual(parseArgs([], "/repo"), expectedDefault);
});

test("parseArgs recognizes help", () => {
  assert.deepEqual(parseArgs(["--help"], "/repo"), {
    ...expectedDefault,
    showHelp: true,
  });
  assert.deepEqual(parseArgs(["-h"], "/repo"), {
    ...expectedDefault,
    showHelp: true,
  });
});

test("parseArgs supports project skills mode", () => {
  assert.deepEqual(parseArgs(["--skills", "project"], "/repo"), {
    ...expectedDefault,
    skills: { mode: "project" },
  });
});

test("parseArgs supports global skills mode", () => {
  assert.deepEqual(parseArgs(["--skills=global"], "/repo"), {
    ...expectedDefault,
    skills: { mode: "global" },
  });
});

test("parseArgs supports none skills mode", () => {
  assert.deepEqual(parseArgs(["--skills", "none"], "/repo"), {
    ...expectedDefault,
    skills: { mode: "none" },
  });
});

test("parseArgs supports path skills mode", () => {
  assert.deepEqual(parseArgs(["--skills", "path:foo"], "/repo"), {
    ...expectedDefault,
    skills: { mode: "path", path: "foo" },
  });
});

test("parseArgs rejects missing skills value", () => {
  assert.throws(
    () => parseArgs(["--skills"], "/repo"),
    /--skills requires one of project, global, none, or path:<dir>/,
  );
});

test("parseArgs rejects unsupported skills values", () => {
  assert.throws(
    () => parseArgs(["--skills", "unknown"], "/repo"),
    /--skills requires one of project, global, none, or path:<dir>/,
  );
});

test("parseArgs rejects empty path skills value", () => {
  assert.throws(
    () => parseArgs(["--skills=path:"], "/repo"),
    /--skills path:<dir> requires a non-empty directory/,
  );
});

test("parseArgs rejects whitespace-only path skills value", () => {
  assert.throws(
    () => parseArgs(["--skills=path:   "], "/repo"),
    /--skills path:<dir> requires a non-empty directory/,
  );
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
