import assert from "node:assert/strict";
import { test } from "node:test";
import { HELP_TEXT, createCliMain, resolveCommand } from "./main.ts";

test("resolveCommand returns help with no command", () => {
  assert.equal(resolveCommand([], ["triage", "run-once"]), "help");
});

test("resolveCommand maps triage to the public command name", () => {
  assert.deepEqual(resolveCommand(["triage", "--dry-run"], ["triage"]), {
    command: "triage",
    args: ["--dry-run"],
  });
});

test("resolveCommand maps run-once to the public command name", () => {
  assert.deepEqual(resolveCommand(["run-once", "--issue", "7"], ["run-once"]), {
    command: "run-once",
    args: ["--issue", "7"],
  });
});

test("resolveCommand rejects unknown commands", () => {
  assert.throws(
    () => resolveCommand(["queue"], ["triage", "run-once"]),
    /Unknown command: queue/,
  );
});

test("resolveCommand rejects inherited property names", () => {
  assert.throws(
    () => resolveCommand(["toString"], ["triage", "run-once"]),
    /Unknown command: toString/,
  );
});

test("createCliMain prints top-level help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const main = createCliMain(new Map(), {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(await main(["--help"]), 0);
  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.deepEqual(stderr, []);
});

test("createCliMain dispatches selected command with remaining args", async () => {
  const calls: string[][] = [];
  const main = createCliMain(
    new Map([
      [
        "triage",
        async (args) => {
          calls.push(args);
          return 17;
        },
      ],
    ]),
  );

  assert.equal(await main(["triage", "--dry-run"]), 17);
  assert.deepEqual(calls, [["--dry-run"]]);
});

test("createCliMain reports unknown commands with help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const main = createCliMain(new Map([["triage", async () => 0]]), {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(await main(["queue"]), 1);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ["Unknown command: queue", HELP_TEXT]);
});
