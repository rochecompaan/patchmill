import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PiRunner } from "./runner.ts";
import { parsePiResult } from "../../scripts/agent-issue/pi.ts";
import type { ResolvedAgentTeam } from "../../scripts/agent-issue/agent-team.ts";
import type { AgentIssueProgressEvent, ProgressReporter } from "../../scripts/agent-issue/progress.ts";
import type { CommandResult, CommandRunner, IssueSummary } from "../../scripts/agent-issue-triage/types.ts";
import type { ImplementationPiInput } from "./types.ts";

type RecordedCall = {
  command: string;
  args: string[];
  cwd?: string;
  prompt: string;
};

const issue: IssueSummary = {
  number: 42,
  title: "Fix pi runner delegation",
  body: "Ensure PiRunner passes the right worktree context.",
  labels: ["bug", "agent-ready"],
  state: "open",
  author: "ana",
  updated: "2026-05-23T12:00:00Z",
  comments: [{ author: "sam", created: "2026-05-23T12:30:00Z", body: "Please preserve resume context." }],
};

const agentTeam: ResolvedAgentTeam = {
  name: "fast-team",
  path: "/teams/fast-team.json",
  roles: {
    worker: { model: "gpt-5-mini", thinking: "low" },
    reviewer: { model: "gpt-5", thinking: "high" },
  },
};

function createFakeRunner(
  respond: (call: RecordedCall) => CommandResult | Promise<CommandResult>,
): CommandRunner & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async run(command, args, options = {}) {
      const promptArg = args.find((arg) => arg.startsWith("@"));
      const prompt = promptArg ? await readFile(promptArg.slice(1), "utf8") : "";
      const call = { command, args: [...args], cwd: options.cwd, prompt };
      calls.push(call);
      return await respond(call);
    },
  };
}

function createProgressRecorder(): {
  events: AgentIssueProgressEvent[];
  reporter: ProgressReporter;
} {
  const events: AgentIssueProgressEvent[] = [];
  return {
    events,
    reporter: {
      event(event) {
        events.push(event);
      },
    },
  };
}

test("Pi result parser accepts merged status", () => {
  assert.deepEqual(parsePiResult(JSON.stringify({
    status: "merged",
    branch: "agent/issue-1-fix",
    mergeCommit: "abc123",
    commits: ["def456"],
    validation: ["npm test passed"],
    reviewSummary: "review passed",
    landingDecision: "direct squash-landed: simple localized bug fix",
  })), {
    status: "merged",
    branch: "agent/issue-1-fix",
    mergeCommit: "abc123",
    commits: ["def456"],
    validation: ["npm test passed"],
    reviewSummary: "review passed",
    landingDecision: "direct squash-landed: simple localized bug fix",
  });
});

test("PiRunner plan forwards runOptions into runPiPrompt", async () => {
  const repoRoot = "/repo";
  const planPath = "docs/plans/2026-05-23-pi-runner.md";
  const { events, reporter } = createProgressRecorder();
  const runner = createFakeRunner((call) => {
    assert.equal(call.command, "pi");
    assert.equal(call.cwd, repoRoot);
    assert.ok(call.args.includes("-p"));
    assert.ok(call.args.includes("--session-dir"));
    assert.match(call.prompt, /Create an implementation plan/);
    assert.match(call.prompt, new RegExp(planPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return {
      code: 0,
      stdout: JSON.stringify({ status: "plan-created", planPath, commit: "abc123" }),
      stderr: "",
    };
  });

  const result = await new PiRunner(runner).plan({
    repoRoot,
    issue,
    planPath,
    runOptions: {
      observeSession: true,
      progress: reporter,
    },
  });

  assert.deepEqual(result, {
    status: "plan-created",
    planPath,
    commit: "abc123",
  });
  assert.equal(runner.calls.length, 1);
  assert.ok(events.some((event) => event.stage === "pi-plan" && event.message === "started pi"));
});

test("PiRunner implementation uses the worktree root, preserves resume context, and keeps runner metadata authoritative", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-runner-"));
  const worktreePath = "worktrees/issue-42-fix";
  const worktreeRoot = join(repoRoot, worktreePath);
  const planPath = "docs/plans/2026-05-23-pi-runner.md";
  await mkdir(join(worktreeRoot, ".pi", "todos"), { recursive: true });
  await writeFile(
    join(worktreeRoot, ".pi", "todos", "issue-42-task-01-fix-bug.md"),
    `${JSON.stringify({ title: "issue-42-task-01-fix-bug", status: "open" })}\nTask body`,
    "utf8",
  );

  const { events, reporter } = createProgressRecorder();
  const runner = createFakeRunner(async (call) => {
    assert.equal(call.command, "pi");
    assert.equal(call.cwd, worktreeRoot);
    assert.ok(call.args.includes("--session-dir"));
    assert.match(call.prompt, /Resume context:/);
    assert.match(call.prompt, /Existing commit: abc123/);
    assert.match(call.prompt, /Worktree: worktrees\/issue-42-fix/);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      code: 0,
      stdout: JSON.stringify({
        status: "merged",
        branch: "agent/issue-42-fix",
        mergeCommit: "merge123",
        commits: ["commit123"],
        validation: ["node --test src\/pi\/*.test.ts"],
      }),
      stderr: "",
    };
  });

  const runOptions = {
    observeSession: true,
    progress: reporter,
    heartbeatMs: 1,
    repoRoot: join(repoRoot, "wrong-root"),
  } as unknown as ImplementationPiInput["runOptions"];

  const result = await new PiRunner(runner).implementation({
    repoRoot,
    issue,
    planPath,
    branch: "agent/issue-42-fix",
    worktreePath,
    agentTeam,
    resume: {
      resumed: true,
      worktreeCreated: false,
      existingCommits: ["abc123"],
    },
    runOptions,
  });

  assert.deepEqual(result, {
    status: "merged",
    branch: "agent/issue-42-fix",
    mergeCommit: "merge123",
    commits: ["commit123"],
    validation: ["node --test src\/pi\/*.test.ts"],
    reviewSummary: undefined,
    landingDecision: undefined,
  });
  assert.equal(runner.calls.length, 1);
  assert.ok(events.some((event) => event.stage === "pi-implementation" && event.message === "started pi"));
  assert.ok(events.some((event) => event.stage === "pi-implementation" && event.level === "heartbeat" && event.message.includes("task 1/1")));
});
