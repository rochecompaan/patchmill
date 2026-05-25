import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PiRunner } from "./runner.ts";
import { parsePiResult } from "../cli/commands/run-once/pi.ts";
import { assertNoLegacyProjectText } from "../../test-support/legacy-project-text.ts";
import type { ResolvedAgentTeam } from "../cli/commands/run-once/agent-team.ts";
import type {
  AgentIssueProgressEvent,
  ProgressReporter,
} from "../cli/commands/run-once/progress.ts";
import type {
  CommandResult,
  CommandRunner,
  IssueSummary,
} from "../cli/commands/triage/types.ts";
import { DEFAULT_PATCHMILL_SKILLS } from "../workflow/skills.ts";
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
  comments: [
    {
      author: "sam",
      created: "2026-05-23T12:30:00Z",
      body: "Please preserve resume context.",
    },
  ],
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
      const prompt = promptArg
        ? await readFile(promptArg.slice(1), "utf8")
        : "";
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
  assert.deepEqual(
    parsePiResult(
      JSON.stringify({
        status: "merged",
        branch: "agent/issue-1-fix",
        mergeCommit: "abc123",
        commits: ["def456"],
        validation: ["npm test passed"],
        reviewSummary: "review passed",
        landingDecision: "direct squash-landed: simple localized bug fix",
      }),
    ),
    {
      status: "merged",
      branch: "agent/issue-1-fix",
      mergeCommit: "abc123",
      commits: ["def456"],
      validation: ["npm test passed"],
      reviewSummary: "review passed",
      landingDecision: "direct squash-landed: simple localized bug fix",
    },
  );
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
    assert.match(
      call.prompt,
      new RegExp(planPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assertNoLegacyProjectText(call.prompt);
    return {
      code: 0,
      stdout: JSON.stringify({
        status: "plan-created",
        planPath,
        commit: "abc123",
      }),
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
  assert.ok(
    events.some(
      (event) => event.stage === "pi-plan" && event.message === "started pi",
    ),
  );
});

test("PiRunner plan passes configured ready and needs-info labels into the prompt", async () => {
  const repoRoot = "/repo";
  const planPath = "docs/plans/2026-05-23-pi-runner-custom-labels.md";
  const runner = createFakeRunner((call) => {
    assert.equal(call.command, "pi");
    assert.match(
      call.prompt,
      /Treat `ready-for-bots` as meaning the issue is already clear and unambiguous enough to plan/,
    );
    assert.match(
      call.prompt,
      /post directly as a `needs-clarification` comment/,
    );
    assert.doesNotMatch(
      call.prompt,
      /Treat `agent-ready` as meaning the issue is already clear and unambiguous enough to plan/,
    );
    assert.doesNotMatch(call.prompt, /post directly as a `needs-info` comment/);
    return {
      code: 0,
      stdout: JSON.stringify({
        status: "plan-created",
        planPath,
        commit: "def456",
      }),
      stderr: "",
    };
  });

  const result = await new PiRunner(runner).plan({
    repoRoot,
    issue: {
      ...issue,
      title: "Use configured workflow labels",
      body: "This issue is already clear enough for planning.",
      labels: ["ready-for-bots", "bug"],
      comments: [
        {
          author: "sam",
          created: "2026-05-23T12:30:00Z",
          body: "Please use the configured workflow labels.",
        },
      ],
    },
    planPath,
    triageLabels: {
      ready: "ready-for-bots",
      needsInfo: "needs-clarification",
    },
  });

  assert.deepEqual(result, {
    status: "plan-created",
    planPath,
    commit: "def456",
  });
});

test("PiRunner implementation uses the worktree root, derives the default landing branch from git.baseBranch, preserves resume context, and keeps runner metadata authoritative", async () => {
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
    assert.match(
      call.prompt,
      /Update local `release\/1\.2` from the `origin` remote\./,
    );
    assert.doesNotMatch(
      call.prompt,
      /Update local `main` from the `origin` remote\./,
    );
    assertNoLegacyProjectText(call.prompt);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      code: 0,
      stdout: JSON.stringify({
        status: "merged",
        branch: "agent/issue-42-fix",
        mergeCommit: "merge123",
        commits: ["commit123"],
        validation: ["node --test src/pi/*.test.ts"],
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
    git: {
      baseBranch: "release/1.2",
      remote: "origin",
      allowDirectLand: true,
    },
    skills: {
      ...DEFAULT_PATCHMILL_SKILLS,
      landing: "project-landing",
    },
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
    validation: ["node --test src/pi/*.test.ts"],
    reviewSummary: undefined,
    landingDecision: undefined,
  });
  assert.equal(runner.calls.length, 1);
  assert.ok(
    events.some(
      (event) =>
        event.stage === "pi-implementation" && event.message === "started pi",
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.stage === "pi-implementation" &&
        event.level === "heartbeat" &&
        event.message.includes("task 1/1"),
    ),
  );
});
