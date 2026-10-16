import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CONFIG_FILE } from "../../../config/config.ts";
import { runCommand } from "../../../process/command.ts";
import { main } from "./main.ts";

async function harness(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "patchmill-triage-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, CONFIG_FILE),
    JSON.stringify({ labels: { ready: "queue" } }),
  );
  const stdout: string[] = [],
    stderr: string[] = [];
  return {
    root,
    stdout,
    stderr,
    options: {
      repoRoot: root,
      output: {
        stdout: (s: string) => stdout.push(s),
        stderr: (s: string) => stderr.push(s),
      },
    },
  };
}

test("strict flags reject malformed issue numbers and unsupported arguments before effects", async (t) => {
  const f = await harness(t);
  await rm(join(f.root, CONFIG_FILE));
  for (const args of [
    ["--issue"],
    ["--issue", "0"],
    ["--issue", "-1"],
    ["--issue", "1.5"],
    ["--issue", "1e2"],
    ["--issue", "9007199254740992"],
    ["--issue", "1", "--issue", "2"],
    ["--plan-only"],
    ["9"],
    ["--wat"],
  ]) {
    f.stderr.length = 0;
    assert.equal(await main(args, f.options), 1);
    assert.match(f.stderr.join("\n"), /Use|Unknown/);
  }
});

test("assembles checked Host and bundled Pi, forwards flags and output", async (t) => {
  const f = await harness(t);
  const runner: typeof runCommand = async (command, args, options) => {
    assert.equal(command, "gh");
    assert.ok(
      [
        JSON.stringify(["--version"]),
        JSON.stringify(["auth", "status"]),
        JSON.stringify(["api", "user", "--jq", ".login"]),
      ].includes(JSON.stringify(args)),
    );
    assert.equal(options?.cwd, f.root);
    return { code: 0, stdout: "", stderr: "" };
  };
  let entered = false;
  assert.equal(
    await main(["--issue", "9", "--dry-run"], {
      ...f.options,
      runner,
      runTriage: async (config, deps, options) => {
        entered = true;
        assert.equal(config.labels.ready, "queue");
        assert.equal(deps.repoRoot, f.root);
        assert.ok(deps.now() instanceof Date);
        assert.equal(deps.piCommand.command, process.execPath);
        assert.equal(
          (await stat(deps.piCommand.argsPrefix[0]!)).isFile(),
          true,
        );
        assert.equal(options.issue, 9);
        assert.equal(options.dryRun, true);
        assert.equal(options.signal?.aborted, false);
        deps.output.stdout("queue: Looks clear.");
        return [{ issue: 9, label: "queue", applied: false }];
      },
    }),
    0,
  );
  assert.equal(entered, true);
  assert.deepEqual(f.stdout, ["queue: Looks clear."]);
  assert.deepEqual(f.stderr, []);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`${signal} aborts kernel and listeners are removed after success and error`, async (t) => {
    const f = await harness(t);
    const before = process.listeners(signal);
    for (const fails of [false, true]) {
      assert.equal(
        await main([], {
          ...f.options,
          runner: async () => ({ code: 0, stdout: "", stderr: "" }),
          runTriage: async (_config, _deps, options) => {
            process.emit(signal);
            assert.equal(options.signal?.aborted, true);
            if (fails) throw new Error("triage failed");
            return [];
          },
        }),
        fails ? 1 : 0,
      );
      assert.deepEqual(process.listeners(signal), before);
    }
    assert.match(f.stderr.join("\n"), /triage failed/);
  });
}

test("Host readiness failure prevents kernel entry", async (t) => {
  const f = await harness(t);
  assert.equal(
    await main([], {
      ...f.options,
      runner: async () => ({ code: 1, stdout: "", stderr: "login required" }),
      runTriage: async () => assert.fail("kernel entered"),
    }),
    1,
  );
  assert.match(f.stderr.join("\n"), /login required/);
});

test("missing configuration fails before Host commands", async (t) => {
  const f = await harness(t);
  await rm(join(f.root, CONFIG_FILE));
  assert.equal(
    await main([], {
      ...f.options,
      runner: async () => assert.fail("host entered"),
    }),
    1,
  );
  assert.match(f.stderr.join("\n"), /Missing/);
});

test("registered triage help is effect free outside a repository", async (t) => {
  const f = await harness(t);
  await rm(join(f.root, CONFIG_FILE));
  const result = await runCommand(
    process.execPath,
    [join(process.cwd(), "bin/patchmill.ts"), "triage", "--help"],
    { cwd: f.root },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Usage: patchmill triage/);
  assert.equal(result.stderr, "");
});
