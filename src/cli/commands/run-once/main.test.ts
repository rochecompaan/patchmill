import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CONFIG_FILE } from "../../../config/config.ts";
import type { RunOnceOutcome } from "../../../kernel/run-once.ts";
import { runCommand } from "../../../process/command.ts";
import { main } from "./main.ts";
import { setupCleanup } from "../../../../test-support/merged-cleanup-fixture.ts";
import { sweepMergedIssues } from "../../../kernel/merged-cleanup-sweep.ts";
import { access, readFile } from "node:fs/promises";

const cliIssue = {
  number: 9,
  title: "Work",
  body: "",
  state: "OPEN",
  author: { login: "owner" },
  labels: [{ name: "queue" }],
  url: "url",
  createdAt: "2026-01-01",
  comments: [],
};
const interactiveRunner: typeof runCommand = async (command, args) => {
  assert.equal(command, "gh");
  return {
    code: 0,
    stderr: "",
    stdout: JSON.stringify(args[0] === "issue" ? cliIssue : [[]]),
  };
};

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
      runner: interactiveRunner,
      sweepMergedIssues: async () => {},
      exit: (_code: number) => {},
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

for (const eligible of [true, false]) {
  test(`--interactive selects before opening the console (eligible: ${eligible})`, async (t) => {
    const f = await harness(t);
    let entered = false;
    const code = await main(["--interactive"], {
      ...f.options,
      runner: async (command, args) => {
        assert.equal(command, "gh");
        assert.equal(args[0], "api");
        if (args.some((arg) => arg.includes("/dependencies/blocked_by")))
          return { code: 0, stderr: "", stdout: "[[]]" };
        assert.ok(
          args.includes("repos/{owner}/{repo}/issues?state=open&per_page=100"),
        );
        return {
          code: 0,
          stderr: "",
          stdout: JSON.stringify(
            eligible
              ? [
                  {
                    number: 10,
                    title: "newer",
                    body: "",
                    state: "open",
                    user: { login: "owner" },
                    html_url: "url",
                    labels: [{ name: "queue" }],
                    created_at: "2026-02-01",
                    comments: [],
                  },
                  {
                    number: 9,
                    title: "oldest",
                    body: "",
                    state: "open",
                    user: { login: "owner" },
                    html_url: "url",
                    labels: [{ name: "queue" }],
                    created_at: "2026-01-01",
                    comments: [],
                  },
                ]
              : [],
          ),
        };
      },
      startConsole: async ({ issue }) => {
        entered = true;
        assert.equal(issue, 9);
        return 0;
      },
    });
    assert.equal(code, 0, f.stderr.join("\n"));
    assert.equal(entered, eligible);
    if (!eligible) assert.match(f.stdout.join("\n"), /No eligible issue/);
  });
}

for (const flag of ["--dry-run", "--plan-only"]) {
  test(`--interactive rejects ${flag} before loading configuration`, async (t) => {
    const f = await harness(t);
    await rm(join(f.root, CONFIG_FILE));
    assert.equal(
      await main(["--issue", "9", "--interactive", flag], f.options),
      1,
    );
    assert.deepEqual(f.stderr, [
      "--interactive cannot be combined with --dry-run or --plan-only.",
    ]);
  });
}

for (const unreadable of [false, true]) {
  for (const explicit of [false, true]) {
    test(`interactive dependency refusal never opens a console (explicit=${explicit}, unreadable=${unreadable})`, async (t) => {
      const f = await harness(t);
      const code = await main(
        ["--interactive", ...(explicit ? ["--issue", "9"] : [])],
        {
          ...f.options,
          runner: async (_command, args) => {
            if (args[0] === "issue")
              return { code: 0, stderr: "", stdout: JSON.stringify(cliIssue) };
            if (args.some((arg) => arg.includes("/dependencies/blocked_by")))
              return unreadable
                ? { code: 1, stderr: "dependencies unavailable", stdout: "" }
                : {
                    code: 0,
                    stderr: "",
                    stdout: JSON.stringify([
                      [
                        {
                          number: 1,
                          state: "open",
                          repository_url:
                            "https://api.github.com/repos/owner/repo",
                        },
                      ],
                    ]),
                  };
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                [
                  {
                    ...cliIssue,
                    state: "open",
                    user: { login: "owner" },
                    html_url: "url",
                    created_at: "2026-01-01",
                  },
                ],
              ]),
            };
          },
          startConsole: async () => assert.fail("console opened"),
        },
      );
      assert.equal(code, explicit ? 1 : 0);
      if (explicit)
        assert.match(
          f.stderr.join("\n"),
          unreadable ? /dependencies unavailable/ : /owner\/repo#1/,
        );
      else assert.match(f.stdout.join("\n"), /No eligible issue/);
    });
  }
}

for (const explicit of [false, true]) {
  test(`interactive startup sweeps before empty/closed selection (explicit=${explicit})`, async (t) => {
    const c = await setupCleanup(t);
    const f = await harness(t);
    const before = process.listeners("SIGTERM");
    const code = await main(
      ["--interactive", ...(explicit ? ["--issue", "9"] : [])],
      {
        ...f.options,
        runner: async (_command, args) => ({
          code: 0,
          stderr: "",
          stdout: JSON.stringify(
            args[0] === "issue" ? { ...cliIssue, state: "CLOSED" } : [[]],
          ),
        }),
        sweepMergedIssues: async (input) => {
          assert.equal(input.repoRoot, f.root);
          assert.equal(input.signal?.aborted, false);
          await sweepMergedIssues(c.services);
        },
        startConsole: async () =>
          assert.fail("console opened for empty selection"),
      },
    );
    assert.equal(code, explicit ? 1 : 0);
    assert.equal(await readFile(c.counter, "utf8"), "hook ran\n");
    await assert.rejects(access(c.worktree));
    assert.deepEqual(process.listeners("SIGTERM"), before);
  });
}

test("interactive startup cancellation restores listeners without starting the console", async (t) => {
  const f = await harness(t);
  const before = process.listeners("SIGTERM");
  const code = await main(["--interactive", "--issue", "9"], {
    ...f.options,
    sweepMergedIssues: async (input) => {
      process.emit("SIGTERM");
      assert.equal(input.signal?.aborted, true);
    },
    startConsole: async () => assert.fail("console opened after cancellation"),
  });
  assert.equal(code, 1);
  assert.deepEqual(process.listeners("SIGTERM"), before);
});

test("--interactive hands the issue and real dependencies to the console", async (t) => {
  const f = await harness(t);
  const runner: typeof runCommand = async (command, args, options) => {
    if (command === "gh") return interactiveRunner(command, args, options);
    assert.equal(command, "git");
    assert.deepEqual(args, ["fetch", "--prune", "origin"]);
    assert.equal(options?.cwd, f.root);
    return { code: 0, stdout: "", stderr: "" };
  };
  let entered = false;
  assert.equal(
    await main(["--issue", "9", "--interactive"], {
      ...f.options,
      runner,
      runOneIssue: async () => assert.fail("non-interactive kernel entered"),
      startConsole: async ({ config, deps, issue }) => {
        entered = true;
        assert.equal(issue, 9);
        assert.equal(config.labels.ready, "queue");
        assert.equal(deps.repoRoot, f.root);
        assert.equal(deps.runner, runner);
        assert.equal(deps.piCommand.command, process.execPath);
        assert.equal(typeof deps.host.viewIssue, "function");
        await deps.git.fetch();
        return 7;
      },
    }),
    7,
  );
  assert.equal(entered, true);
});

for (const code of [0, 1]) {
  test(`interactive completion exits ${code} only after console cleanup`, async (t) => {
    const f = await harness(t);
    const events: string[] = [];
    assert.equal(
      await main(["--interactive", "--issue", "9"], {
        ...f.options,
        startConsole: async () => {
          events.push("start");
          await new Promise<void>((resolve) => setImmediate(resolve));
          events.push("cleanup complete");
          return code;
        },
        exit: (status) => {
          events.push(`exit ${status}`);
        },
      }),
      code,
    );
    assert.deepEqual(events, ["start", "cleanup complete", `exit ${code}`]);
  });
}
