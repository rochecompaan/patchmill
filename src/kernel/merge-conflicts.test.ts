import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createGitFixture } from "../../test-support/git-fixture.ts";
import {
  CommandFailedError,
  runCommand,
  type CommandRunner,
} from "../process/command.ts";
import type { Facts } from "./facts.ts";
import { createKernelGit, type MergeConflict } from "./git.ts";
import {
  conflictResolutionGaps,
  findConflictingPullRequests,
  isRecordedAttempt,
  recordConflictAttempt,
} from "./merge-conflicts.ts";
import { FakeHost, writeFakeHostState } from "../../test-support/fake-host.ts";
import type { PullRequest } from "../host/types.ts";
import type { TrackedIssue } from "./workflow-state.ts";

/** Each branch (default `b`) and `main` add `a.txt` with different text. */
async function conflictRepo(t: TestContext, branches = ["b"]) {
  const f = await createGitFixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const runner: CommandRunner = (command, args, options) =>
    runCommand(command, args, { ...options, env: f.env });
  const seed = join(f.dir, "seed");
  const git = async (args: string[], cwd = seed) => {
    const result = await runner("git", args, { cwd });
    if (result.code !== 0 && !(args[0] === "merge" && result.code === 1))
      throw new CommandFailedError("git", args, result);
    return result.stdout.trim();
  };
  const commit = async (files: Record<string, string>, message: string) => {
    for (const [path, text] of Object.entries(files))
      await fs.writeFile(join(seed, path), text);
    await git(["add", "-A"]);
    await git(["commit", "-m", message]);
  };
  for (const branch of branches) {
    await git(["checkout", "-b", branch, "main"]);
    await commit({ "a.txt": `${branch}\n` }, "branch");
  }
  await git(["checkout", "main"]);
  await commit({ "a.txt": "main\n" }, "main");
  await git(["push", "origin", "main", ...branches]);
  const kernel = createKernelGit(runner, f.repoRoot);
  await kernel.fetch();
  const before = (await kernel.mergeConflict(
    "origin/main",
    `origin/${branches[0]}`,
  ))!;
  assert.deepEqual(before.files, ["a.txt"]);
  return { ...f, git, commit, kernel, before };
}

const factsFor = (fields: Partial<Facts> & Pick<Facts, "branch">): Facts => ({
  stage: "implementation",
  remoteBranchExists: true,
  worktree: "/worktree",
  baseBranch: "main",
  expectedSpecPath: "s.md",
  expectedPlanPath: "p.md",
  ...fields,
});

async function after(c: Awaited<ReturnType<typeof conflictRepo>>) {
  await c.kernel.fetch();
  const conflict = await c.kernel.mergeConflict("origin/main", "origin/b");
  return factsFor({
    branch: "b",
    ...(conflict ? { mergeConflict: conflict } : {}),
  });
}

const short = (sha: string) => sha.slice(0, 7);

test("a merge of base that resolves the conflict has no gaps", async (t) => {
  const c = await conflictRepo(t);
  await c.git(["checkout", "b"]);
  await c.git(["merge", "main"]);
  await c.commit({ "a.txt": "both\n" }, "Merge main");
  await c.git(["push", "origin", "b"]);
  assert.deepEqual(
    await conflictResolutionGaps(c.kernel, c.before, await after(c)),
    [],
  );
});

test("history rewrite is a gap", async (t) => {
  const c = await conflictRepo(t);
  await c.git(["checkout", "-B", "b", "main"]);
  await c.commit({ "a.txt": "rewritten\n" }, "Rewrite");
  await c.git(["push", "--force", "origin", "b"]);
  assert.deepEqual(
    await conflictResolutionGaps(c.kernel, c.before, await after(c)),
    [
      `The pushed branch does not contain its previous head ${short(c.before.headSha)}; its history was rewritten.`,
    ],
  );
});

test("a push without base is a gap", async (t) => {
  const c = await conflictRepo(t);
  await c.git(["checkout", "b"]);
  await c.commit({ "other.txt": "x\n" }, "Other");
  await c.git(["push", "origin", "b"]);
  assert.deepEqual(
    await conflictResolutionGaps(c.kernel, c.before, await after(c)),
    [
      "The pull request still conflicts with origin/main in: a.txt.",
      `The pushed branch does not contain origin/main at ${short(c.before.baseSha)}; merge the base branch.`,
    ],
  );
});

test("a remaining conflict is a gap", async (t) => {
  const c = await conflictRepo(t);
  const gaps = await conflictResolutionGaps(
    c.kernel,
    c.before,
    factsFor({ branch: "b", mergeConflict: c.before }),
  );
  assert.equal(
    gaps[0],
    "The pull request still conflicts with origin/main in: a.txt.",
  );
});

test("a moved base is worded as a new conflict", async (t) => {
  const c = await conflictRepo(t);
  const moved: MergeConflict = {
    ...c.before,
    baseSha: "f".repeat(40),
    files: ["a.txt", "b.txt"],
  };
  const gaps = await conflictResolutionGaps(
    c.kernel,
    c.before,
    factsFor({ branch: "b", mergeConflict: moved }),
  );
  assert.equal(
    gaps[0],
    "The pull request conflicts with origin/main again at fffffff in: a.txt, b.txt; the base moved during the session.",
  );
});

test("a deleted remote branch skips the ancestry checks", async (t) => {
  const c = await conflictRepo(t);
  assert.deepEqual(
    await conflictResolutionGaps(
      c.kernel,
      c.before,
      factsFor({ branch: "gone", remoteBranchExists: false }),
    ),
    [],
  );
});

const NOW = new Date("2026-11-23T12:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

const tracked = (number: number, createdAt: string): TrackedIssue => ({
  number,
  title: `Issue ${number}`,
  body: "",
  labels: [],
  state: "open",
  url: `https://example.invalid/${number}`,
  author: "fixture",
  createdAt,
  comments: [],
  status: "done",
});

const pull = (number: number, fields: Partial<PullRequest>): PullRequest => ({
  number,
  url: `https://example.invalid/pulls/${number}`,
  state: "open",
  draft: false,
  body: "",
  headRepository: "fixture/repo",
  headBranch: "agent/issue-9-x",
  baseBranch: "main",
  ...fields,
});

async function searchSetup(
  t: TestContext,
  pullRequests: PullRequest[],
  branches = ["agent/issue-9-x", "agent/issue-10-y"],
) {
  const c = await conflictRepo(t, branches);
  const stateFile = join(c.dir, "host.json");
  writeFakeHostState(stateFile, { pullRequests });
  const host = new FakeHost(stateFile);
  const reports: string[] = [];
  const issueDir = (issue: number) => join(c.dir, "runs", `issue-${issue}`);
  const search = (candidates: TrackedIssue[]) =>
    findConflictingPullRequests({
      host,
      git: c.kernel,
      candidates,
      baseBranch: "main",
      issueDir,
      retryMinutes: 30,
      now: () => NOW,
      report: (line) => reports.push(line),
    });
  const sha = (ref: string) => c.git(["rev-parse", ref], c.repoRoot);
  return { ...c, host, reports, issueDir, search, sha };
}

test("lists conflicting done issues oldest first", async (t) => {
  const c = await searchSetup(t, [
    pull(1, {}),
    pull(2, { headBranch: "agent/issue-10-y" }),
  ]);
  const found = await c.search([
    tracked(9, "2026-10-02"),
    tracked(10, "2026-10-01"),
  ]);
  assert.deepEqual(
    found.map((candidate) => [
      candidate.issue.number,
      candidate.pullRequest.number,
    ]),
    [
      [10, 2],
      [9, 1],
    ],
  );
  assert.deepEqual(found[1]!.conflict, {
    baseSha: await c.sha("origin/main"),
    headSha: await c.sha("origin/agent/issue-9-x"),
    files: ["a.txt"],
  });
  assert.deepEqual(c.reports, []);
});

test("an empty candidate list calls no host method", async (t) => {
  const c = await searchSetup(t, [pull(1, {})]);
  assert.deepEqual(await c.search([]), []);
  assert.deepEqual(c.host.state().calls, []);
});

test("skips clean, fork, planning, and wrong-base pull requests", async (t) => {
  for (const [name, pr, branches] of [
    [
      "clean",
      pull(1, { headBranch: "agent/issue-9-clean" }),
      ["agent/issue-9-clean"],
    ],
    ["fork", pull(1, { headRepository: "fork/repo" }), undefined],
    [
      "planning",
      pull(1, { headBranch: "agent/issue-9-x--spec" }),
      ["agent/issue-9-x--spec"],
    ],
    ["wrong base", pull(1, { baseBranch: "develop" }), undefined],
  ] as const) {
    await t.test(name, async (t) => {
      const c = await searchSetup(
        t,
        [pr],
        branches ? [...branches] : undefined,
      );
      if (name === "clean") {
        // Make the branch merge cleanly: it now matches main's a.txt.
        await c.git(["checkout", "agent/issue-9-clean"]);
        await c.git(["merge", "main"]);
        await c.commit({ "a.txt": "main\n" }, "resolve");
        await c.git(["push", "origin", "agent/issue-9-clean"]);
      }
      assert.deepEqual(await c.search([tracked(9, "2026-10-01")]), []);
      assert.deepEqual(c.reports, []);
    });
  }
});

test("several open pull requests are skipped with a report", async (t) => {
  const c = await searchSetup(t, [
    pull(1, {}),
    pull(2, { headBranch: "agent/issue-9-other" }),
  ]);
  assert.deepEqual(await c.search([tracked(9, "2026-10-01")]), []);
  assert.deepEqual(c.reports, [
    "Issue #9 conflict check skipped: several open pull requests: #1, #2",
  ]);
});

async function recorded(
  c: Awaited<ReturnType<typeof searchSetup>>,
  startedAt: string,
  baseSha?: string,
) {
  const conflict: MergeConflict = {
    baseSha: baseSha ?? (await c.sha("origin/main")),
    headSha: await c.sha("origin/agent/issue-9-x"),
    files: ["a.txt"],
  };
  await recordConflictAttempt(c.issueDir(9), {
    runId: "run-1",
    startedAt,
    conflict,
  });
  return conflict;
}

test("same head and base is skipped", async (t) => {
  const c = await searchSetup(t, [pull(1, {})]);
  const conflict = await recorded(c, minutesAgo(120));
  assert.deepEqual(await c.search([tracked(9, "2026-10-01")]), []);
  assert.deepEqual(c.reports, [
    `Issue #9 conflict resolution skipped: already attempted at head ${short(conflict.headSha)} and base ${short(conflict.baseSha)}`,
  ]);
});

test("a young record is skipped", async (t) => {
  const c = await searchSetup(t, [pull(1, {})]);
  await recorded(c, minutesAgo(10), "e".repeat(40));
  assert.deepEqual(await c.search([tracked(9, "2026-10-01")]), []);
  assert.deepEqual(c.reports, [
    `Issue #9 conflict resolution skipped: last attempt at ${minutesAgo(10)}; retry after ${new Date(NOW.getTime() + 20 * 60_000).toISOString()}`,
  ]);
});

test("an old record with a new base is listed", async (t) => {
  const c = await searchSetup(t, [pull(1, {})]);
  await recorded(c, minutesAgo(31), "e".repeat(40));
  assert.equal((await c.search([tracked(9, "2026-10-01")])).length, 1);
  assert.deepEqual(c.reports, []);
});

test("an unreadable record is treated as missing", async (t) => {
  const c = await searchSetup(t, [pull(1, {})]);
  await fs.mkdir(c.issueDir(9), { recursive: true });
  await fs.writeFile(join(c.issueDir(9), "merge-conflict-attempt.json"), "{");
  assert.equal((await c.search([tracked(9, "2026-10-01")])).length, 1);
  assert.equal(c.reports.length, 1);
  assert.match(
    c.reports[0]!,
    /^Issue #9 conflict attempt record is unreadable: /,
  );
});

test("listing failure reports and returns nothing", async (t) => {
  const c = await searchSetup(t, [pull(1, {})]);
  c.host.listOpenPullRequests = async () => {
    throw new Error("host down");
  };
  assert.deepEqual(await c.search([tracked(9, "2026-10-01")]), []);
  assert.deepEqual(c.reports, ["Merge conflict check failed: host down"]);
});

test("recordConflictAttempt writes the record", async (t) => {
  const c = await searchSetup(t, [pull(1, {})]);
  const conflict = await recorded(c, minutesAgo(5));
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        join(c.issueDir(9), "merge-conflict-attempt.json"),
        "utf8",
      ),
    ),
    {
      runId: "run-1",
      startedAt: minutesAgo(5),
      headSha: conflict.headSha,
      baseSha: conflict.baseSha,
    },
  );
  const report = (line: string) => c.reports.push(line);
  assert.equal(await isRecordedAttempt(c.issueDir(9), conflict, report), true);
  assert.equal(
    await isRecordedAttempt(
      c.issueDir(9),
      { ...conflict, headSha: "d".repeat(40) },
      report,
    ),
    false,
  );
  assert.equal(
    await isRecordedAttempt(c.issueDir(10), conflict, report),
    false,
  );
});
