import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { issueThreadFixture } from "../../test-support/issue-thread-fixture.ts";
import { boardIssue, boardProgress } from "../../test-support/board-fixture.ts";
import { feedClock } from "../../test-support/feed-clock.ts";
import { writeRunProgress } from "../kernel/run-progress.ts";
import { runCommand, type CommandRunner } from "../process/command.ts";
import type { Issue } from "../host/types.ts";
import type { PatchmillConfig } from "../config/config.ts";
import type { IssueUpdate } from "./api-types.ts";
import { createFileRunDataSource } from "./file-run-data.ts";

const BRANCH = "agent/issue-9-docs";
const SPEC = "docs/specs/2026-11-20-issue-9-docs-design.md";
const MOCKUP = "docs/mockups/m.html";
const MOCKUP_ID = `mockup-${createHash("sha256").update(MOCKUP).digest("hex").slice(0, 12)}`;

async function fixture(
  t: TestContext,
  options: {
    runner?: CommandRunner;
    issues?: (issue: Issue, config: PatchmillConfig) => Issue[];
  } = {},
) {
  const f = await issueThreadFixture(t);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: f.repoRoot, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.test");
  git("config", "user.name", "Test");
  git("commit", "-q", "--allow-empty", "-m", "Base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("checkout", "-q", "-b", BRANCH);
  const commit = async (files: Record<string, string>) => {
    for (const [path, body] of Object.entries(files)) {
      await fs.mkdir(dirname(join(f.repoRoot, path)), { recursive: true });
      await fs.writeFile(join(f.repoRoot, path), body);
    }
    git("add", "--", ...Object.keys(files));
    git("commit", "-q", "-m", "Docs");
    return git("rev-parse", "HEAD");
  };
  await commit({
    [SPEC]: "# Docs\n\n[Mockup](../mockups/m.html)\n",
    [MOCKUP]: "<p>m</p>",
  });
  await writeRunProgress(
    f.issueDir,
    boardProgress({
      facts: {
        stage: "implementation",
        branch: BRANCH,
        baseBranch: "main",
        specPath: SPEC,
        planPath: null,
        parentSpec: null,
        pullRequest: null,
      },
    }),
  );
  const calls: string[][] = [];
  const runner: CommandRunner =
    options.runner ??
    ((cmd, args, opts) => {
      calls.push([cmd, ...args]);
      return runCommand(cmd, args, opts);
    });
  const clock = feedClock();
  const source = createFileRunDataSource({
    ...f,
    metadata: {
      repository: { name: "owner/repo", url: "https://host/owner/repo" },
      baseBranch: "main",
      pushRepository: { slug: "owner/repo", url: "https://host/owner/repo" },
    },
    host: {
      listOpenIssues: async () =>
        options.issues ? options.issues(f.issue, f.config) : [f.issue],
      listOpenPullRequests: async () => [],
    },
    runner,
    now: () => new Date("2026-11-14T14:00:00Z"),
    clock,
  });
  return { ...f, git, commit, calls, source, clock };
}

test("live detail lists Issue documents", async (t) => {
  const f = await fixture(t);
  await f.source.snapshot();
  assert.equal(
    f.calls.some((c) => c.includes("cat-file")),
    false,
    "the board reads no blob",
  );
  const detail = (await f.source.snapshot({ issue: 9 })).details["9"]!;
  assert.deepEqual(
    detail.artifacts.map((a) => [a.kind, a.id, a.title, a.draft]),
    [
      ["spec", "spec", "Docs", true],
      ["mockup", MOCKUP_ID, "Mockup", true],
    ],
  );
});

test("documentFile serves a listed mockup", async (t) => {
  const f = await fixture(t);
  const file = await f.source.documentFile!(9, MOCKUP_ID);
  assert.equal(file?.body.toString("utf8"), "<p>m</p>");
  assert.equal(await f.source.documentFile!(10, MOCKUP_ID), null);
  assert.equal(await f.source.documentFile!(9, "mockup-000000000000"), null);
});

test("documentFile follows page eligibility", async (t) => {
  const unsuitable = await fixture(t, {
    issues: (issue, config) => [
      { ...boardIssue(9, [config.labels.unsuitable]), body: issue.body },
    ],
  });
  assert.equal(await unsuitable.source.documentFile!(9, MOCKUP_ID), null);
  const closed = await fixture(t, {
    issues: (issue) => [{ ...issue, state: "closed" }],
  });
  assert.equal(await closed.source.documentFile!(9, MOCKUP_ID), null);
});

test("document failure keeps the issue page", async (t) => {
  const f = await fixture(t, {
    runner: async () => ({ code: 128, stdout: "", stderr: "fatal" }),
  });
  const detail = (await f.source.snapshot({ issue: 9 })).details["9"]!;
  assert.deepEqual(detail.artifacts, []);
  assert.deepEqual(
    f.warnings.filter((w) => w === "Could not read documents for issue #9."),
    ["Could not read documents for issue #9."],
  );
  const updates: IssueUpdate[] = [];
  const stop = f.source.subscribe({ issue: 9, lastEventId: null }, (u) =>
    updates.push(u),
  );
  t.after(stop);
  for (let n = 0; n < 50 && updates.length === 0; n++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(updates[0]?.kind, "reset");
});

test("a new commit updates the feed", async (t) => {
  const f = await fixture(t);
  const updates: IssueUpdate[] = [];
  const stop = f.source.subscribe({ issue: 9, lastEventId: null }, (u) =>
    updates.push(u),
  );
  t.after(stop);
  for (let n = 0; n < 100 && updates.length === 0; n++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(updates[0]?.kind, "reset");
  const head = await f.commit({ [SPEC]: "# Docs v2\n" });
  const until = Date.now() + 10000;
  while (!updates.some((u) => u.kind === "header") && Date.now() < until) {
    await f.clock.advance(1000);
    await new Promise((r) => setTimeout(r, 50));
  }
  const header = updates.find((u) => u.kind === "header");
  assert.ok(header?.kind === "header", "header update arrived");
  const spec = header.header.artifacts.find((a) => a.kind === "spec");
  assert.equal(spec?.commit, head.slice(0, 7));
  assert.equal(spec?.title, "Docs v2");
});
