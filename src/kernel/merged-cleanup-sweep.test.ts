import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { setupCleanup } from "../../test-support/merged-cleanup-fixture.ts";
import {
  branch,
  implement,
  mergePullRequest,
  plan,
  setupRun,
  spec,
} from "../../test-support/run-once-fixture.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";
import { acquireLock } from "./lock.ts";
import {
  discoverCleanupCandidates,
  sweepMergedIssues,
} from "./merged-cleanup-sweep.ts";
import type { CommandRunner } from "../process/command.ts";

type Fixture = Awaited<ReturnType<typeof setupCleanup>>;
async function anotherIssue(c: Fixture) {
  const head = "agent/issue-10-other";
  const worktree = join(c.repoRoot, ".worktrees/agent-issue-10-other");
  await c.git(["worktree", "add", "-b", head, worktree, branch]);
  await c.mutate((state) => {
    state.issues.push({
      ...state.issues[0]!,
      number: 10,
      title: "Other",
      comments: [],
    });
    state.pullRequests.push({
      ...state.pullRequests[0]!,
      number: 2,
      headBranch: head,
      body: "Closes #10",
    });
  });
  return worktree;
}

for (const mode of [
  "automatic",
  "explicit",
  "plan-only",
  "remote removed",
] as const) {
  test(`real run sweeps a closed merged issue before selection: ${mode}`, async (t) => {
    const c = await setupCleanup(t);
    if (mode === "remote removed")
      await c.git(["push", "origin", "--delete", branch]);
    const before = c.host.state().calls.length;
    const outcome = await c.run(
      mode === "explicit"
        ? { issue: 9 }
        : mode === "plan-only"
          ? { planOnly: true }
          : {},
    );
    assert.equal(outcome.status, mode === "explicit" ? "refused" : "no-work");
    assert.equal(await fs.readFile(c.counter, "utf8"), "hook ran\n");
    await assert.rejects(fs.access(c.worktree));
    assert.equal(await c.localBranch(), false);
    assert.equal(
      c.host
        .state()
        .calls.slice(before)
        .some((call) => /^(setLabels:|commentIssue:|createLabel:)/.test(call)),
      false,
    );
    const records = await c.records();
    assert.equal(records.result.sessions.length, 1);
  });
}

test("quitting the Review wait before merge is recovered by the next real run", async (t) => {
  const c = await setupRun(t, [implement]);
  const counter = join(c.dir, "counter");
  await c.seed({
    [spec]: "spec",
    [plan]: "plan",
    "cleanup.sh": `echo ran >> ${JSON.stringify(counter)}\n`,
  });
  c.config.cleanupHook = "./cleanup.sh";
  const human = fakeHuman(c);
  assert.equal((await c.run({ issue: 9 }, { human })).status, "completed");
  await assert.rejects(fs.access(counter));
  await mergePullRequest(c, branch, { closeIssue: true });
  assert.equal((await c.run()).status, "no-work");
  assert.equal(await fs.readFile(counter, "utf8"), "ran\n");
  await assert.rejects(fs.access(c.worktree));
  assert.equal(human.calls.filter((call) => call === "wait:review").length, 1);
});

test("dry run performs no cleanup writes, mutations, or candidate locks", async (t) => {
  const c = await setupCleanup(t);
  const other = await anotherIssue(c);
  const lockBefore = await fs.stat(c.lockPath);
  const commands: string[] = [];
  const runner: CommandRunner = (command, args, options) => {
    commands.push(`${command} ${args.join(" ")}`);
    return c.deps.runner(command, args, options);
  };
  assert.equal((await c.run({ dryRun: true }, { runner })).status, "no-work");
  assert.deepEqual(commands, []);
  await fs.access(c.worktree);
  await fs.access(other);
  await assert.rejects(fs.access(c.counter));
  await assert.rejects(fs.access(join(c.issueDir, "cleanup.json")));
  await assert.rejects(fs.access(join(c.issueDir, "cleanup.log")));
  await assert.rejects(
    fs.access(join(c.repoRoot, c.config.paths.runsDir, "issue-10/lock")),
  );
  assert.equal((await fs.stat(c.lockPath)).mtimeMs, lockBefore.mtimeMs);
});

for (const mode of ["contended", "ambiguous", "host error"] as const) {
  test(`one unsafe candidate does not block another issue: ${mode}`, async (t) => {
    const c = await setupCleanup(t);
    const other = await anotherIssue(c);
    let held;
    if (mode === "contended") {
      held = await acquireLock(c.lockPath);
      await fs.writeFile(c.lockPath, "");
    }
    if (mode === "ambiguous") await c.git(["branch", "agent/issue-9-other"]);
    if (mode === "host error") {
      const original = c.host.viewIssue.bind(c.host);
      c.host.viewIssue = async (issue) => {
        if (issue === 9) throw new Error("host unavailable");
        return original(issue);
      };
    }
    try {
      await sweepMergedIssues(c.services);
    } finally {
      await held?.release();
    }
    await fs.access(c.worktree);
    await assert.rejects(fs.access(other));
    assert.equal(await fs.readFile(c.counter, "utf8"), "hook ran\n");
    assert.match(
      c.output.join("\n"),
      mode === "contended"
        ? /lock|active/i
        : mode === "ambiguous"
          ? /ambiguous|several/i
          : /host unavailable/,
    );
  });
}

test("sweep orders candidates and holds at most its current issue lock", async (t) => {
  const c = await setupCleanup(t);
  const other = await anotherIssue(c);
  const seen: string[] = [];
  const runner: CommandRunner = async (command, args, options) => {
    if (command === "bash") {
      const current = options?.cwd === c.worktree ? 9 : 10;
      seen.push(String(current));
      const otherLock = await acquireLock(
        current === 9
          ? join(c.repoRoot, c.config.paths.runsDir, "issue-10/lock")
          : c.lockPath,
      );
      await otherLock.release();
    }
    return c.deps.runner(command, args, options);
  };
  await sweepMergedIssues({ ...c.services, runner });
  assert.deepEqual(seen, ["9", "10"]);
  await assert.rejects(fs.access(other));
  assert.equal(await fs.readFile(c.counter, "utf8"), "hook ran\nhook ran\n");
});

for (const authorized of [true, false]) {
  test(`planning-only leftovers use the receipt but fresh host facts authorize removal: ${authorized}`, async (t) => {
    const c = await setupCleanup(t);
    const planning = await c.planning();
    await fs.writeFile(join(planning[0]!.path, "dirty"), "keep");
    assert.equal((await c.cleanup()).status, "kept");
    await assert.rejects(fs.access(c.worktree));
    await fs.rm(join(planning[0]!.path, "dirty"));
    if (!authorized)
      await c.mutate((state) => {
        state.pullRequests[0]!.state = "open";
      });
    assert.deepEqual(await discoverCleanupCandidates(c.services), [
      { issue: 9, branch },
    ]);
    await sweepMergedIssues(c.services);
    if (authorized) await assert.rejects(fs.access(planning[0]!.path));
    else await fs.access(planning[0]!.path);
    assert.equal(await fs.readFile(c.counter, "utf8"), "hook ran\n");
  });
}

test("planning-only branches without a receipt never trigger cleanup", async (t) => {
  const c = await setupCleanup(t);
  const planning = await c.planning();
  await c.git(["worktree", "remove", c.worktree]);
  await c.git(["branch", "-D", branch]);
  assert.deepEqual(await discoverCleanupCandidates(c.services), []);
  await sweepMergedIssues(c.services);
  for (const workspace of planning) await fs.access(workspace.path);
  await assert.rejects(fs.access(c.counter));
});

test("repeated sweeps retain dirt without repeating a successful hook", async (t) => {
  const c = await setupCleanup(t);
  await fs.writeFile(join(c.worktree, "dirty"), "keep");
  await sweepMergedIssues(c.services);
  await sweepMergedIssues(c.services);
  await c.cleanup();
  assert.equal(await fs.readFile(c.counter, "utf8"), "hook ran\n");
  await fs.access(c.worktree);
  await fs.rm(join(c.worktree, "dirty"));
  await sweepMergedIssues(c.services);
  await assert.rejects(fs.access(c.worktree));
});

test("already-aborted sweep does not discover or acquire locks", async (t) => {
  const c = await setupCleanup(t);
  await sweepMergedIssues({
    ...c.services,
    signal: AbortSignal.abort(),
    runner: async () => assert.fail("discovered after abort"),
  });
  await fs.access(c.worktree);
  await assert.rejects(fs.access(c.counter));
});
