import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createGitFixture } from "./git-fixture.ts";
import { FakeHost, writeFakeHostState } from "./fake-host.ts";
import { DEFAULT_CONFIG } from "../src/config/config.ts";
import { runCommand, type CommandRunner } from "../src/process/command.ts";
import { createKernelGit } from "../src/kernel/git.ts";
import {
  runOneIssue,
  type RunOnceDeps,
  type RunOnceOptions,
} from "../src/kernel/run-once.ts";

export const spec = "docs/specs/2026-10-15-issue-9-add-login-design.md";
export const plan = "docs/plans/2026-10-15-issue-9-add-login-plan.md";
export const done = { status: "done", summary: "Login work complete" };
export const branch = "agent/issue-9-add-login";
export async function setupRun(t: TestContext, steps: unknown[] = []) {
  const f = await createGitFixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const stateFile = join(f.dir, "host.json");
  writeFakeHostState(stateFile, {
    issues: [
      {
        number: 9,
        title: "Add login",
        body: "Login",
        labels: ["agent-ready"],
        state: "open",
        url: "https://example.invalid/9",
        author: "fixture",
        createdAt: "2026-10-15",
        comments: [],
      },
    ],
  });
  const host = new FakeHost(stateFile);
  const script = join(f.dir, "steps.json");
  await fs.writeFile(script, JSON.stringify(steps));
  const wrapper = join(f.dir, "pi.mjs");
  await fs.writeFile(
    wrapper,
    `Object.assign(process.env, ${JSON.stringify({ ...f.env, PATCHMILL_FAKE_PI_SCRIPT: script, PATCHMILL_FAKE_HOST_STATE: stateFile })}); (await import('node:fs')).writeFileSync(${JSON.stringify(join(f.dir, "pi.pid"))}, String(process.pid)); await import(${JSON.stringify(new URL("./fake-pi.mjs", import.meta.url).href)});`,
  );
  const runner: CommandRunner = (cmd, args, opts) =>
    runCommand(cmd, args, { ...opts, env: f.env });
  const git = async (args: string[], cwd = f.repoRoot) => {
    const r = await runner("git", args, { cwd });
    assert.equal(r.code, 0, r.stderr);
    return r.stdout.trim();
  };
  const config = structuredClone(DEFAULT_CONFIG);
  config.pi.timeoutMinutes = 0.2;
  const output: string[] = [];
  t.mock.method(
    process.stdout,
    "write",
    (chunk: string, callback?: () => void) => {
      output.push(String(chunk));
      callback?.();
      return true;
    },
  );
  t.mock.method(
    process.stderr,
    "write",
    (chunk: string, callback?: () => void) => {
      output.push(String(chunk));
      callback?.();
      return true;
    },
  );
  const deps: RunOnceDeps = {
    host,
    runner,
    git: createKernelGit(runner, f.repoRoot),
    piCommand: { command: process.execPath, argsPrefix: [wrapper] },
    extensionPaths: [],
    repoRoot: f.repoRoot,
    now: () => new Date(2026, 9, 15, 12),
    output: { stdout: (s) => output.push(s), stderr: (s) => output.push(s) },
  };
  const seed = async (files: Record<string, string>, head = branch) => {
    const cwd = join(f.dir, "seed");
    for (const [p, text] of Object.entries(files)) {
      await fs.mkdir(join(cwd, p, ".."), { recursive: true });
      await fs.writeFile(join(cwd, p), text);
    }
    await git(["add", "."], cwd);
    await git(["commit", "-m", "Artifacts"], cwd);
    await git(["push", "origin", `HEAD:${head}`], cwd);
  };
  const mutate = (fn: (state: ReturnType<FakeHost["state"]>) => void) => {
    const state = host.state();
    fn(state);
    return fs.writeFile(stateFile, JSON.stringify(state));
  };
  const run = (options: RunOnceOptions = {}) =>
    runOneIssue(config, deps, options);
  const records = async () => {
    const root = join(f.repoRoot, config.paths.runsDir, "issue-9");
    const entries = (await fs.readdir(root)).filter((n) => n !== "lock");
    assert.equal(entries.length, 1);
    const dir = join(root, entries[0]!);
    return {
      dir,
      result: JSON.parse(await fs.readFile(join(dir, "result.json"), "utf8")),
      prompt: () => fs.readFile(join(dir, "prompt.md"), "utf8"),
    };
  };
  return {
    ...f,
    host,
    config,
    deps,
    git,
    seed,
    mutate,
    run,
    records,
    script,
    output,
    lockPath: join(f.repoRoot, config.paths.runsDir, "issue-9/lock"),
    worktree: join(f.repoRoot, ".worktrees/agent-issue-9-add-login"),
  };
}
