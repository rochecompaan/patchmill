import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HELP_TEXT, createCliMain, main, resolveCommand } from "./main.ts";

test("resolveCommand returns help with no command", () => {
  assert.equal(
    resolveCommand([], ["init", "doctor", "triage", "run-once"]),
    "help",
  );
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

test("resolveCommand maps setup-test-repo to the public command name", () => {
  assert.deepEqual(
    resolveCommand(
      ["setup-test-repo", "--provider", "github-gh"],
      ["setup-test-repo"],
    ),
    {
      command: "setup-test-repo",
      args: ["--provider", "github-gh"],
    },
  );
});

test("resolveCommand maps init to the public command name", () => {
  assert.deepEqual(resolveCommand(["init"], ["init"]), {
    command: "init",
    args: [],
  });
});

test("resolveCommand maps doctor to the public command name", () => {
  assert.deepEqual(resolveCommand(["doctor", "--quiet"], ["doctor"]), {
    command: "doctor",
    args: ["--quiet"],
  });
});

test("main prints the package version", async () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  ) as { version: string };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  try {
    console.log = (line?: unknown) => stdout.push(String(line));
    console.error = (line?: unknown) => stderr.push(String(line));

    assert.equal(await main(["version"]), 0);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  assert.deepEqual(stdout, [packageJson.version]);
  assert.deepEqual(stderr, []);
});

test("resolveCommand rejects unknown commands", () => {
  assert.throws(
    () => resolveCommand(["queue"], ["init", "doctor", "triage", "run-once"]),
    /Unknown command: queue/,
  );
});

test("resolveCommand rejects inherited property names", () => {
  assert.throws(
    () =>
      resolveCommand(["toString"], ["init", "doctor", "triage", "run-once"]),
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
  assert.match(HELP_TEXT, /init\s+Create a minimal patchmill\.config\.json\./);
  assert.match(HELP_TEXT, /doctor\s+Run read-only readiness checks\./);
  assert.match(HELP_TEXT, /version\s+Print the Patchmill CLI version\./);
  assert.match(
    HELP_TEXT,
    /setup-test-repo\s+Create or reset a disposable Patchmill demo repository\./,
  );
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

test("createCliMain dispatches setup-test-repo command", async () => {
  const calls: string[][] = [];
  const main = createCliMain(
    new Map([
      [
        "setup-test-repo",
        async (args) => {
          calls.push(args);
          return 0;
        },
      ],
    ]),
  );

  assert.equal(
    await main([
      "setup-test-repo",
      "--provider",
      "github-gh",
      "--repo",
      "OWNER/REPO",
    ]),
    0,
  );
  assert.deepEqual(calls, [
    ["--provider", "github-gh", "--repo", "OWNER/REPO"],
  ]);
});

test("createCliMain dispatches init and doctor commands", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const main = createCliMain(
    new Map([
      [
        "init",
        async (args) => {
          calls.push({ command: "init", args });
          return 0;
        },
      ],
      [
        "doctor",
        async (args) => {
          calls.push({ command: "doctor", args });
          return 0;
        },
      ],
    ]),
  );

  assert.equal(await main(["init"]), 0);
  assert.equal(await main(["doctor", "--quiet"]), 0);
  assert.deepEqual(calls, [
    { command: "init", args: [] },
    { command: "doctor", args: ["--quiet"] },
  ]);
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
