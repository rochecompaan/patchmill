import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CONFIG_FILE } from "../../../config/config.ts";
import { runCommand } from "../../../process/command.ts";

import * as init from "./main.ts";
async function harness(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "patchmill-init-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal((await runCommand("git", ["init"], { cwd: root })).code, 0);
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    root,
    stdout,
    stderr,
    options: {
      repoRoot: root,
      host: {
        checkCli: async () => ({ ok: true, message: "ready", login: "alice" }),
      },
      output: {
        stdout: (line: string) => stdout.push(line),
        stderr: (line: string) => stderr.push(line),
      },
    },
  };
}

for (const [provider, login, expected] of [
  ["github-gh", undefined, "alice"],
  ["forgejo-tea", undefined, ""],
  ["github-gh", "explicit", "explicit"],
  ["forgejo-tea", "work", "work"],
] as const) {
  test(`${provider} stores ${expected || "the empty default"} with login flag ${login}`, async (t) => {
    const f = await harness(t);
    const args = ["--provider", provider, ...(login ? ["--login", login] : [])];
    assert.equal(await init.main(args, f.options), 0, f.stderr.join("\n"));
    const path = join(f.root, CONFIG_FILE);
    const bytes = await readFile(path, "utf8");
    assert.equal(JSON.parse(bytes).host.provider, provider);
    assert.equal(JSON.parse(bytes).host.login, expected);
    const before = (await stat(path)).mtimeMs;
    f.stdout.length = 0;
    assert.equal(await init.main(args, f.options), 0);
    assert.equal(await readFile(path, "utf8"), bytes);
    assert.equal((await stat(path)).mtimeMs, before);
    assert.equal(f.stdout.length, 5);
    assert.ok(
      f.stdout.every((line) => /unchanged|ready/i.test(line)),
      f.stdout.join("\n"),
    );
  });
}

test("existing configuration bytes and host flags win, with configured agent and runtime excludes", async (t) => {
  const f = await harness(t);
  const bytes =
    '{ "host": {"provider":"forgejo-tea","login":"work"}, "pi":{"agentDir":"local/agent"}, "paths":{"worktreeDir":"local/trees","runsDir":"local/runs"}}\n';
  await writeFile(join(f.root, CONFIG_FILE), bytes);
  assert.equal(
    await init.main(
      ["--provider", "github-gh", "--login", "ignored"],
      f.options,
    ),
    0,
  );
  assert.equal(await readFile(join(f.root, CONFIG_FILE), "utf8"), bytes);
  await stat(join(f.root, "local/agent/agents/reviewer.md"));
  await stat(join(f.root, ".patchmill/skills/patchmill-planning/SKILL.md"));
  const excludes = await readFile(join(f.root, ".git/info/exclude"), "utf8");
  for (const path of ["local/agent/", "local/trees/", "local/runs/"])
    assert.ok(excludes.split("\n").includes(path));
});

test("invalid configuration fails before host probes and provisioning", async (t) => {
  const f = await harness(t);
  await writeFile(join(f.root, CONFIG_FILE), '{"host":{"wrong":true}}');
  assert.equal(
    await init.main([], {
      ...f.options,
      host: { checkCli: async () => assert.fail("host probed") },
    }),
    1,
  );
  assert.match(f.stderr.join("\n"), /host.wrong/);
  await assert.rejects(stat(join(f.root, ".patchmill")));
});

for (const thrown of [false, true]) {
  test(`host readiness failure warns without blocking local provisioning (thrown=${thrown})`, async (t) => {
    const f = await harness(t);
    assert.equal(
      await init.main([], {
        ...f.options,
        host: {
          checkCli: async () => {
            if (thrown) throw new Error("offline");
            return { ok: false, message: "offline" };
          },
        },
      }),
      0,
    );
    assert.match(f.stderr.join("\n"), /warning.*offline/i);
    assert.equal(
      JSON.parse(await readFile(join(f.root, CONFIG_FILE), "utf8")).host.login,
      "",
    );
    await stat(join(f.root, ".patchmill/pi-agent/agents/reviewer.md"));
  });
}

test("registered init rejects invalid flags before provisioning and serves help", async (t) => {
  const f = await harness(t);
  for (const args of [["--provider", "bad"], ["--login"], ["--wat"]]) {
    const result = await runCommand(
      process.execPath,
      [join(process.cwd(), "bin/patchmill.ts"), "init", ...args],
      { cwd: f.root },
    );
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stderr, /Unknown command: init/);
    await assert.rejects(stat(join(f.root, CONFIG_FILE)));
  }
  const result = await runCommand(
    process.execPath,
    [join(process.cwd(), "bin/patchmill.ts"), "init", "--help"],
    { cwd: f.root },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Usage: patchmill init/);
});
