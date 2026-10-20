import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CONFIG_FILE } from "../../../config/config.ts";
import type { RunOnceOutcome } from "../../../kernel/run-once.ts";
import { runCommand } from "../../../process/command.ts";
import { main } from "./main.ts";

async function harness(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "patchmill-run-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, CONFIG_FILE),
    JSON.stringify({ labels: { ready: "queue" } }),
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    root,
    stdout,
    stderr,
    options: {
      repoRoot: root,
      output: {
        stdout: (line: string) => stdout.push(line),
        stderr: (line: string) => stderr.push(line),
      },
    },
  };
}

test("invalid arguments fail before loading configuration or starting work", async (t) => {
  const f = await harness(t);
  await rm(join(f.root, CONFIG_FILE));
  for (const args of [
    ["--issue", "x"],
    ["--issue"],
    ["--issue", "0"],
    ["--issue", "-1"],
    ["--issue", "1.2"],
    ["--issue", "1e2"],
    ["--issue", "9007199254740992"],
    ["--issue", "9", "--issue", "10"],
    ["--wat"],
    ["9"],
  ]) {
    f.stderr.length = 0;
    assert.equal(await main(args, f.options), 1);
    assert.match(f.stderr.join("\n"), /Use|Unknown/);
  }
});

test("dry-run assembles real dependencies, parses options and forwards kernel output", async (t) => {
  const f = await harness(t);
  const runner: typeof runCommand = async (command, args, options) => {
    assert.equal(command, "git");
    assert.deepEqual(args, ["fetch", "--prune", "origin"]);
    assert.equal(options?.cwd, f.root);
    return { code: 0, stdout: "", stderr: "" };
  };
  const code = await main(["--plan-only", "--issue", "9", "--dry-run"], {
    ...f.options,
    runner,
    runOneIssue: async (config, deps, options) => {
      assert.equal(config.labels.ready, "queue");
      assert.equal(deps.repoRoot, f.root);
      assert.equal(deps.runner, runner);
      assert.equal(deps.piCommand.command, process.execPath);
      assert.equal((await stat(deps.piCommand.argsPrefix[0]!)).isFile(), true);
      assert.equal(deps.extensionPaths.length, 1);
      assert.equal(
        (await stat(join(deps.extensionPaths[0]!, "package.json"))).isFile(),
        true,
      );
      assert.ok(deps.now() instanceof Date);
      assert.equal(typeof deps.host.listOpenIssues, "function");
      await deps.git.fetch();
      assert.equal(options.issue, 9);
      assert.equal(options.dryRun, true);
      assert.equal(options.planOnly, true);
      assert.equal(options.signal?.aborted, false);
      deps.output.stdout(
        '{"issue":9,"derived":{"kind":"phase","phase":"planning"}}',
      );
      return {
        status: "dry-run",
        issue: 9,
        derived: { kind: "phase", phase: "planning" },
      };
    },
  });
  assert.equal(code, 0);
  assert.equal(f.stdout.length, 1);
  assert.equal(JSON.parse(f.stdout[0]!).derived.phase, "planning");
  assert.deepEqual(f.stderr, []);
});

const outcomes: [RunOnceOutcome, number][] = [
  [{ status: "completed", issue: 9 }, 0],
  [
    {
      status: "stopped",
      issue: 9,
      label: "needsInfo",
      summary: "not verified",
    },
    0,
  ],
  [{ status: "dry-run", issue: 9, derived: "ambiguous-branches" }, 0],
  [{ status: "no-work" }, 0],
  [{ status: "refused", issue: 9, reason: "already claimed" }, 1],
  [{ status: "claimed-elsewhere", issue: 9 }, 1],
  [{ status: "completed", issue: 9, publicationErrors: ["Comment failed"] }, 1],
  [
    {
      status: "stopped",
      issue: 9,
      label: "inProgress",
      summary: "Waiting for merge",
      publicationErrors: ["Label update failed"],
    },
    1,
  ],
];
for (const [outcome, expected] of outcomes) {
  const errors =
    "publicationErrors" in outcome ? " with publication errors" : "";
  test(`maps ${outcome.status}${errors} to exit ${expected}`, async (t) => {
    const f = await harness(t);
    assert.equal(
      await main([], { ...f.options, runOneIssue: async () => outcome }),
      expected,
    );
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`${signal} aborts work and listeners are restored after success or error`, async (t) => {
    const f = await harness(t);
    const before = process.listeners(signal);
    for (const fails of [false, true]) {
      const code = await main([], {
        ...f.options,
        runOneIssue: async (_config, _deps, options) => {
          process.emit(signal);
          assert.equal(options.signal?.aborted, true);
          if (fails) throw new Error("owned work error");
          return { status: "no-work" };
        },
      });
      assert.equal(code, fails ? 1 : 0);
      assert.deepEqual(process.listeners(signal), before);
    }
    assert.match(f.stderr.join("\n"), /owned work error/);
  });
}

test("configuration errors return failure without entering the kernel", async (t) => {
  const f = await harness(t);
  await rm(join(f.root, CONFIG_FILE));
  assert.equal(
    await main([], {
      ...f.options,
      runOneIssue: async () => assert.fail("kernel entered"),
    }),
    1,
  );
  assert.match(f.stderr.join("\n"), /configuration|config|ENOENT/i);
});

test("registered run-once and release help work without repository configuration", async (t) => {
  const f = await harness(t);
  for (const command of ["run-once", "release"]) {
    const result = await runCommand(
      process.execPath,
      [join(process.cwd(), "bin/patchmill.ts"), command, "--help"],
      { cwd: f.root },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Usage: patchmill ${command}`));
    assert.equal(result.stderr, "");
  }
});
