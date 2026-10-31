import assert from "node:assert/strict";
import { test } from "node:test";
import { HELP_TEXT, createCliMain } from "./main.ts";

test("createCliMain prints help for the skills-first commands", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const main = createCliMain(new Map(), {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(await main(["--help"]), 0);
  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.deepEqual(stderr, []);
  assert.match(HELP_TEXT, /release/);
  assert.doesNotMatch(HELP_TEXT, /set-spec|skills|run /);
});

test("createCliMain reports unknown commands with help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const main = createCliMain(new Map(), {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(await main(["queue"]), 1);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ["Unknown command: queue", HELP_TEXT]);
});

test("createCliMain dispatches version with remaining arguments", async () => {
  const calls: string[][] = [];
  const main = createCliMain(
    new Map([
      [
        "version",
        async (args) => {
          calls.push(args);
          return 17;
        },
      ],
    ]),
  );

  assert.equal(await main(["version", "--verbose"]), 17);
  assert.deepEqual(calls, [["--verbose"]]);
});
