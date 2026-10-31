import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  FakeHost,
  writeFakeHostState,
} from "../../../../test-support/fake-host.ts";
import { DEFAULT_CONFIG } from "../../../config/config.ts";
import type { CommandRunner } from "../../../process/command.ts";
import { runDoctorChecks } from "./checks.ts";
import { main } from "./main.ts";

async function fixture(t: TestContext) {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-doctor-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const config = structuredClone(DEFAULT_CONFIG);
  config.paths.runsDir = "custom/runs";
  config.pi.agentDir = "custom/agent";
  for (const path of Object.values(config.skills)) {
    await mkdir(join(repoRoot, path), { recursive: true });
    await writeFile(join(repoRoot, path, "SKILL.md"), "fixture");
  }
  await mkdir(join(repoRoot, config.pi.agentDir, "agents"), {
    recursive: true,
  });
  await writeFile(
    join(repoRoot, config.pi.agentDir, "agents/reviewer.md"),
    "fixture",
  );
  const state = join(repoRoot, "host.json");
  writeFakeHostState(state, { labels: Object.values(config.labels) });
  const host = new FakeHost(state);
  const probes: string[] = [];
  const runner: CommandRunner = async (command, args, options) => {
    assert.equal(command, "git");
    assert.deepEqual(args.slice(0, 2), ["check-ignore", "-q"]);
    assert.equal(options?.cwd, repoRoot);
    probes.push(args.at(-1)!);
    return { code: 0, stdout: "", stderr: "" };
  };
  const script = join(repoRoot, "fake-pi.cjs");
  await writeFile(
    script,
    `const fs = require('node:fs');
const args = process.argv.slice(2);
const prompt = args.find(a => a.startsWith('@')).slice(1);
if (!args.includes('-p') || args.includes('--skill') || fs.readFileSync(prompt, 'utf8') !== 'Reply with exactly OK' || process.env.PI_CODING_AGENT_DIR !== ${JSON.stringify(join(repoRoot, config.pi.agentDir))}) process.exit(8);
console.log('OK');`,
  );
  return {
    repoRoot,
    config,
    host,
    runner,
    probes,
    script,
    deps: {
      repoRoot,
      config,
      host,
      runner,
      piCommand: { command: process.execPath, argsPrefix: [script] },
      packageRoot: process.cwd(),
    },
  };
}

test("checks are ordered, read-only, and smoke uses configured paths and supervisor prefix", async (t) => {
  const f = await fixture(t);
  const checks = await runDoctorChecks(f.deps);
  assert.deepEqual(
    checks.map((c) => c.name),
    [
      "host CLI",
      "labels",
      "excludes",
      "skills",
      "reviewer",
      "pi-subagents",
      "Pi smoke",
      "trusted authors",
    ],
  );
  assert.deepEqual(
    checks.map((c) => c.status),
    ["pass", "pass", "pass", "pass", "pass", "pass", "pass", "warn"],
  );
  assert.deepEqual(f.probes, [".worktrees", "custom/runs", "custom/agent"]);
  assert.deepEqual(f.host.state().calls, ["checkCli", "listLabels"]);
  const dirs = await readdir(join(f.repoRoot, "custom/runs"));
  assert.equal(dirs.length, 1);
  assert.match(
    await readFile(join(f.repoRoot, "custom/runs", dirs[0]!, "pi.log"), "utf8"),
    /OK/,
  );
});

test("missing resources fail or warn without preventing later probes", async (t) => {
  const f = await fixture(t);
  writeFakeHostState(join(f.repoRoot, "host.json"), {
    labels: ["agent-ready"],
  });
  await rm(join(f.repoRoot, f.config.skills.planning, "SKILL.md"));
  await rm(join(f.repoRoot, f.config.pi.agentDir, "agents/reviewer.md"));
  const checks = await runDoctorChecks({
    ...f.deps,
    runner: async () => ({ code: 1, stdout: "", stderr: "" }),
  });
  assert.match(checks.find((c) => c.name === "labels")!.message, /in-progress/);
  assert.equal(checks.find((c) => c.name === "labels")!.status, "fail");
  assert.equal(checks.find((c) => c.name === "skills")!.status, "fail");
  assert.equal(checks.find((c) => c.name === "excludes")!.status, "warn");
  assert.equal(checks.find((c) => c.name === "reviewer")!.status, "warn");
  assert.equal(checks.find((c) => c.name === "Pi smoke")!.status, "pass");
});

test("probe exceptions become diagnostics, smoke failures include the log path", async (t) => {
  const f = await fixture(t);
  f.host.checkCli = async () => {
    throw new Error("CLI unavailable");
  };
  f.host.listLabels = async () => {
    throw new Error("labels unavailable");
  };
  await writeFile(f.script, "console.log('not ready'); process.exit(2)");
  const checks = await runDoctorChecks({
    ...f.deps,
    runner: async () => {
      throw new Error("git unavailable");
    },
  });
  assert.equal(checks[0]!.status, "fail");
  assert.match(checks[0]!.message, /CLI unavailable/);
  assert.equal(checks[1]!.status, "fail");
  assert.equal(checks[2]!.status, "warn");
  assert.equal(checks[6]!.status, "fail");
  assert.match(checks[6]!.message, /custom\/runs\/doctor-.*\/pi.log/);
  await writeFile(f.script, "console.log('OK'); process.exit(2)");
  assert.equal((await runDoctorChecks(f.deps))[6]!.status, "fail");
});

test("a host CLI failure remains a failure even without a diagnostic message", async (t) => {
  const f = await fixture(t);
  f.host.checkCli = async () => ({ ok: false, message: "" });
  const checks = await runDoctorChecks(f.deps);
  assert.equal(checks[0]!.status, "fail");
  assert.ok(checks[0]!.message.length > 0);
});

test("doctor CLI prints diagnostics and fails only for failures or invalid input", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.repoRoot, "patchmill.config.json"),
    JSON.stringify(f.config),
  );
  const stdout: string[] = [],
    stderr: string[] = [];
  const options = {
    repoRoot: f.repoRoot,
    host: f.host,
    runner: f.runner,
    piCommand: f.deps.piCommand,
    output: {
      stdout: (s: string) => stdout.push(s),
      stderr: (s: string) => stderr.push(s),
    },
  };
  assert.equal(await main([], options), 0);
  assert.ok(stdout.some((s) => /^\[warn\] trusted authors:/.test(s)));
  assert.ok(stdout.some((s) => /^\[pass\] Pi smoke:/.test(s)));
  f.host.checkCli = async () => ({
    ok: false,
    message: "please install host CLI",
  });
  assert.equal(await main([], options), 1);
  assert.ok(stdout.some((s) => /^\[fail\] host CLI: please install/.test(s)));
  assert.equal(await main(["--bad"], options), 1);
  await writeFile(
    join(f.repoRoot, "patchmill.config.json"),
    '{"retired":true}',
  );
  assert.equal(await main([], options), 1);
  assert.match(stderr.join("\n"), /retired/);
});
