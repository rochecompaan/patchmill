import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CONFIG_FILE } from "../../../config/config.ts";
import type { CommandRunner } from "../../../process/command.ts";
import { main as cliMain } from "../../main.ts";
import { main } from "./main.ts";

async function harness(t: TestContext, fail?: "auth" | "list" | "create") {
  const root = await mkdtemp(join(tmpdir(), "patchmill-labels-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, CONFIG_FILE),
    JSON.stringify({ labels: { ready: "queue" } }),
  );
  const stored = ["queue", "in-progress", "spec-review"];
  const created: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runner: CommandRunner = async (command, args, options) => {
    assert.equal(command, "gh");
    assert.equal(options?.cwd, root);
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    const bad = { code: 1, stdout: "", stderr: "owned fake failure" };
    if (args[0] === "--version") return ok("gh version fake");
    if (args.join(" ") === "auth status") return fail === "auth" ? bad : ok();
    if (args.join(" ") === "api user --jq .login") return ok("fake-user");
    if (args.join(" ") === "label list --limit 200 --json name") {
      return fail === "list"
        ? bad
        : ok(JSON.stringify(stored.map((name) => ({ name }))));
    }
    if (args[0] === "label" && args[1] === "create") {
      if (fail === "create") return bad;
      assert.equal(args[3], "--color");
      assert.match(args[4]!, /^[0-9a-f]{6}$/);
      assert.equal(args[5], "--description");
      assert.ok(args[6]);
      created.push(args[2]!);
      stored.push(args[2]!);
      return ok();
    }
    throw new Error(`Unexpected operation: ${args.join(" ")}`);
  };
  return {
    root,
    created,
    stdout,
    stderr,
    run: (args: string[]) =>
      main(args, {
        repoRoot: root,
        runner,
        output: {
          stdout: (line) => stdout.push(line),
          stderr: (line) => stderr.push(line),
        },
      }),
  };
}

test("labels setup creates missing labels and prints each created name, then reports all present", async (t) => {
  const h = await harness(t);
  assert.equal(await h.run(["setup"]), 0);
  assert.deepEqual(h.created, [
    "needs-info",
    "agent-done",
    "agent-unsuitable",
    "blocked",
  ]);
  assert.deepEqual(
    h.stdout,
    h.created.map((name) => `Created label: ${name}`),
  );
  assert.deepEqual(h.stderr, []);
  h.stdout.length = 0;
  assert.equal(await h.run(["setup"]), 0);
  assert.deepEqual(h.stdout, ["all labels present"]);
});

test("labels without a subcommand shows help and returns 1 before reading configuration or running a host", async (t) => {
  const h = await harness(t);
  await rm(join(h.root, CONFIG_FILE));
  assert.equal(await h.run([]), 1);
  assert.equal(h.stdout.length, 1);
  assert.deepEqual(h.stderr, []);
  assert.deepEqual(h.created, []);
});

test("labels help and invalid arguments return before host setup", async (t) => {
  const h = await harness(t);
  await rm(join(h.root, CONFIG_FILE));
  for (const arg of ["--help", "-h", "help"])
    assert.equal(await h.run([arg]), 0);
  assert.equal(await h.run(["unknown"]), 1);
  assert.equal(await h.run(["setup", "extra"]), 1);
  assert.deepEqual(h.created, []);
});

for (const failure of ["auth", "list", "create"] as const) {
  test(`labels setup reports ${failure} failure and stops before further writes`, async (t) => {
    const h = await harness(t, failure);
    assert.equal(await h.run(["setup"]), 1);
    assert.match(h.stderr.join("\n"), /owned fake failure/);
    assert.deepEqual(h.stdout, []);
    assert.deepEqual(h.created, []);
  });
}

test("labels setup reports missing configuration without calling a provider", async (t) => {
  const h = await harness(t);
  await rm(join(h.root, CONFIG_FILE));
  assert.equal(await h.run(["setup"]), 1);
  assert.match(h.stderr.join("\n"), /Missing/);
  assert.deepEqual(h.created, []);
});

test("top-level CLI registers labels help", async (t) => {
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => lines.push(line));
  t.mock.method(console, "error", (line: string) => {
    throw new Error(line);
  });
  assert.equal(await cliMain(["labels", "--help"]), 0);
  assert.equal(lines.length, 1);
});
