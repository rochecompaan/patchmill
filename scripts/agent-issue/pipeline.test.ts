import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../src/config/defaults.ts";
import { DEFAULT_PATCHMILL_POLICY } from "../../src/policy/defaults.ts";
import { createTriagePolicy } from "../../src/policy/triage.ts";
import { runStatePath, writeRunState } from "./run-state.ts";
import { runOneIssue } from "./pipeline.ts";
import { JsonlProgressReporter } from "./progress.ts";
import { assertNoLegacyProjectText } from "../../test-support/legacy-project-text.ts";
import type {
  AgentIssueConfig,
  AgentIssueProgressEvent,
  CommandRunner,
  CommandResult,
  IssueSummary,
} from "./types.ts";

type Call = {
  command: string;
  args: string[];
  cwd?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

const NOW = new Date("2026-05-09T12:00:00.000Z");
const MINIMAL_PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type MockRunner = CommandRunner & { calls: Call[] };

function withRepo(args: string[], repoRoot: string): string[] {
  const separator = args.indexOf("--");
  if (separator === -1) return [...args, "--repo", repoRoot];
  return [...args.slice(0, separator), "--repo", repoRoot, ...args.slice(separator)];
}

function commentBody(call: Call | undefined): string {
  const separator = call?.args.indexOf("--") ?? -1;
  return separator >= 0 ? (call?.args[separator + 1] ?? "") : "";
}

function issue(
  number: number,
  labels: string[],
  title = `Issue ${number}`,
): IssueSummary {
  return {
    number,
    title,
    body: `Body for issue ${number}`,
    labels,
    state: "open",
    author: "rozanne",
    updated: "2026-05-09T11:00:00Z",
    comments: [
      { author: { login: "ana" }, body: "Please keep this deterministic." },
    ],
  };
}

function issueListPayload(issues: IssueSummary[]): string {
  return JSON.stringify(
    issues.map((entry) => ({
      index: entry.number,
      title: entry.title,
      body: entry.body,
      state: entry.state,
      labels: entry.labels.map((name) => ({ name })),
      author: { login: entry.author },
      updated: entry.updated,
      comments: entry.comments,
    })),
  );
}

const AGENT_TEAM = {
  name: "economy",
  path: "/repo/.pi/agent-teams/economy.json",
  roles: {
    worker: { model: "openai-codex/gpt-5.4", thinking: "medium" },
    reviewer: { model: "openai-codex/gpt-5.5", thinking: "high" },
  },
};

const LANDING_SKILLS = {
  ...DEFAULT_PATCHMILL_CONFIG.skills,
  landing: "project-landing",
};

const cleanupHook = {
  name: "example-cleanup",
  whenPathExists: ".env",
  terminateProcessPatterns: ["example dev server"],
  command: "npm",
  args: ["run", "cleanup:example"],
};

const DEFAULT_LABEL_NAMES = [
  "agent-ready",
  "needs-info",
  "agent-unsuitable",
  "in-progress",
  "agent-done",
  "bug",
  "enhancement",
  "docs",
  "chore",
  "test",
  "priority:low",
  "priority:medium",
  "priority:high",
  "priority:critical",
] as const;

function labelListPayload(
  labels: readonly string[] = DEFAULT_LABEL_NAMES,
): string {
  return JSON.stringify(labels.map((name) => ({ name })));
}

function collectProgressEvents(): {
  events: AgentIssueProgressEvent[];
  progress: { event: (event: AgentIssueProgressEvent) => void };
} {
  const events: AgentIssueProgressEvent[] = [];
  return {
    events,
    progress: {
      event: (event) => {
        events.push(event);
      },
    },
  };
}

function createMockRunner(
  handler: (call: Call) => Promise<CommandResult> | CommandResult,
): MockRunner {
  const calls: Call[] = [];
  return {
    calls,
    async run(command, args, options = {}) {
      const call = {
        command,
        args: [...args],
        cwd: options.cwd,
        onStdout: options.onStdout,
        onStderr: options.onStderr,
      };
      calls.push(call);
      return await handler(call);
    },
  };
}

function promptPath(args: string[]): string {
  const promptArg = args.find((arg) => arg.startsWith("@"));
  assert.ok(promptArg, `expected prompt path in ${args.join(" ")}`);
  return promptArg.slice(1);
}

async function writePiSessionMessage(
  call: Call,
  text: string,
  usage?: { input: number; output: number; totalTokens: number },
): Promise<void> {
  const sessionDirIndex = call.args.indexOf("--session-dir");
  assert.ok(sessionDirIndex >= 0, `expected --session-dir in ${call.args.join(" ")}`);
  const sessionDir = call.args[sessionDirIndex + 1];
  assert.ok(sessionDir);
  const sessionSubdir = join(sessionDir, "--repo--");
  await mkdir(sessionSubdir, { recursive: true });
  await writeFile(
    join(sessionSubdir, "session.jsonl"),
    [
      JSON.stringify({ type: "session", version: 3, id: "session-1", cwd: call.cwd }),
      JSON.stringify({
        type: "message",
        id: "assistant-1",
        parentId: null,
        timestamp: "2026-05-09T12:00:00.000Z",
        message: { role: "assistant", content: [{ type: "text", text }], usage },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
}

async function piSessionPath(call: Call): Promise<string> {
  const sessionDirIndex = call.args.indexOf("--session-dir");
  assert.ok(sessionDirIndex >= 0, `expected --session-dir in ${call.args.join(" ")}`);
  const sessionDir = call.args[sessionDirIndex + 1];
  assert.ok(sessionDir);
  const sessionSubdir = join(sessionDir, "--repo--");
  await mkdir(sessionSubdir, { recursive: true });
  return join(sessionSubdir, "session.jsonl");
}

async function appendPiSessionEntry(call: Call, entry: unknown): Promise<void> {
  await appendFile(await piSessionPath(call), `${JSON.stringify(entry)}\n`, "utf8");
}

async function initializePiSession(call: Call): Promise<void> {
  await writeFile(
    await piSessionPath(call),
    `${JSON.stringify({ type: "session", version: 3, id: "session-1", cwd: call.cwd })}\n`,
    "utf8",
  );
}

function assistantToolCall(toolCallId: string, toolName: string, args: Record<string, unknown>): unknown {
  return {
    type: "message",
    id: `assistant-${toolCallId}`,
    parentId: null,
    timestamp: "2026-05-09T12:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: toolCallId, name: toolName, arguments: args }],
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeTodo(
  repoRoot: string,
  id: string,
  title: string,
  status: string,
): Promise<void> {
  const dir = join(repoRoot, ".pi", "todos");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${id}.md`),
    `${JSON.stringify({ id, title, status })}\n\nbody\n`,
    "utf8",
  );
}

async function makeConfig(
  overrides: Partial<AgentIssueConfig> = {},
): Promise<AgentIssueConfig> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-issue-pipeline-"));
  const plansDir = join(repoRoot, "docs", "plans");
  const runStateDir = join(repoRoot, ".patchmill", "runs");
  await mkdir(plansDir, { recursive: true });

  return {
    repoRoot,
    dryRun: true,
    execute: false,
    planOnly: false,
    plansDir,
    runStateDir,
    worktreeDir: join(repoRoot, ".worktrees"),
    cleanStatusIgnorePrefixes: [".patchmill/runs/", ".patchmill/triage-runs/"],
    cleanupHooks: [],
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    readyLabel: "agent-ready",
    issueLimit: 1,
    requirePlanApproval: false,
    baseBranch: "main",
    baseRef: "HEAD",
    remote: "origin",
    branchPrefix: "agent/issue-",
    worktreePrefix: "patchmill-issue-",
    slugLength: 48,
    allowDirectLand: true,
    skills: { ...DEFAULT_PATCHMILL_CONFIG.skills },
    agentTeam: AGENT_TEAM,
    ...overrides,
  };
}

test("runOneIssue dry-run lists open issues and returns the selected agent-ready issue without mutations", async () => {
  const config = await makeConfig();
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout:
          page === "1"
            ? issueListPayload([
                issue(8, ["agent-ready", "priority:low"]),
                issue(3, ["agent-ready", "priority:high"]),
              ])
            : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const logPath = join(config.runStateDir, "run.jsonl");
  const result = await runOneIssue(runner, config, {
    now: NOW,
    progress,
    logPath,
  });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issue.number, 3);
  assert.equal(result.logPath, logPath);
  assert.deepEqual(
    events.map((event) => event.message),
    ["listing open issues", "selected #3 Issue 3"],
  );
  assert.deepEqual(
    runner.calls.map(
      (call) => `${call.command} ${call.args[0]} ${call.args[1]}`,
    ),
    ["tea issues list", "tea issues list"],
  );
});

test("runOneIssue dry-run ignores resumable in-progress issues and previews the next ready issue", async () => {
  const config = await makeConfig({ dryRun: true, execute: true });
  await writeRunState(
    config.runStateDir,
    { issueNumber: 45, title: "Resume me", status: "planning" },
    NOW.toISOString(),
  );
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea"
      && call.args[0] === "issues"
      && call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1"
          ? issueListPayload([
            issue(45, ["in-progress", "bug"], "Resume me"),
            issue(46, ["agent-ready", "priority:high"], "Ready next"),
          ])
          : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issue.number, 46);
});

test("runOneIssue dry-run previews agent-ready issues even when saved state has stale finished branch and worktree", async () => {
  const config = await makeConfig({ dryRun: true, execute: true });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Stale finished preview",
      status: "finished",
      branch: "agent/issue-45-stale-finished-preview",
      worktreePath: ".worktrees/patchmill-issue-45-stale-finished-preview",
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea"
      && call.args[0] === "issues"
      && call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1"
          ? issueListPayload([issue(45, ["agent-ready", "priority:high"], "Stale finished preview")])
          : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issue.number, 45);
});

test("runOneIssue returns no-issue when no eligible issue exists and performs no mutations", async () => {
  const config = await makeConfig();
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout:
          page === "1"
            ? issueListPayload([
                issue(2, ["needs-info"]),
                issue(4, ["agent-ready", "in-progress"]),
              ])
            : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.deepEqual(result, { status: "no-issue" });
  assert.equal(runner.calls.length, 2);
});

test("runOneIssue resumes a single in-progress issue with run state before selecting ready issues", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, planOnly: true });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Resume in-progress issue",
      status: "planning",
      planPath: "docs/plans/2026-05-14-issue-45-resume-in-progress-issue.md",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
      },
    },
    NOW.toISOString(),
  );
  await writeFile(
    join(
      config.repoRoot,
      "docs",
      "plans",
      "2026-05-14-issue-45-resume-in-progress-issue.md",
    ),
    "# plan\n",
    "utf8",
  );
  const inProgress = issue(45, ["in-progress", "bug"], "Resume in-progress issue");
  const ready = issue(46, ["agent-ready", "bug"], "New ready issue");
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([inProgress, ready]) : "[]", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-found");
  assert.equal(result.issue.number, 45);
  assert.equal(result.planPath, "docs/plans/2026-05-14-issue-45-resume-in-progress-issue.md");
  const editCalls = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 1);
  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 1);
  assert.doesNotMatch(commentBody(comments[0]), /Automation started/);
});

test("runOneIssue ignores its own log file in a non-default run-state directory", async () => {
  const baseConfig = await makeConfig({ dryRun: false, execute: true, planOnly: true });
  const config = {
    ...baseConfig,
    runStateDir: join(baseConfig.repoRoot, "logs", "run-state"),
  };
  const planPath = "docs/plans/2026-05-14-issue-45-resume-in-progress-issue.md";
  const logPath = join(config.runStateDir, "run.jsonl");
  assert.ok(!config.cleanStatusIgnorePrefixes?.includes("logs/run-state/"));
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Resume in-progress issue",
      status: "planning",
      planPath,
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
      },
    },
    NOW.toISOString(),
  );
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  const inProgress = issue(45, ["in-progress", "bug"], "Resume in-progress issue");
  const ready = issue(46, ["agent-ready", "bug"], "New ready issue");
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([inProgress, ready]) : "[]", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "?? logs/run-state/run.jsonl\n", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) {
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, {
    now: NOW,
    progress: new JsonlProgressReporter(logPath),
    logPath,
  });

  assert.equal(result.status, "plan-found");
  assert.equal(result.issue.number, 45);
  assert.equal(result.logPath, logPath);
  assert.match(await readFile(logPath, "utf8"), /checking repository status/);
});

test("runOneIssue rejects multiple resumable in-progress issues", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  await writeRunState(
    config.runStateDir,
    { issueNumber: 45, title: "First", status: "planning" },
    NOW.toISOString(),
  );
  await writeRunState(
    config.runStateDir,
    { issueNumber: 46, title: "Second", status: "implementing" },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"]), issue(46, ["in-progress"])]) : "[]",
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Multiple resumable in-progress automation runs found: #45, #46/,
  );
});

test("runOneIssue rejects an explicit open issue that is not agent-ready with a clear message", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 7,
  });
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(7, ["bug"])]) : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Issue #7 is open but not labeled agent-ready/,
  );
  assert.equal(runner.calls.length, 2);
});

test("runOneIssue rejects a different explicit issue when a resumable run exists", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, issueNumber: 46 });
  await writeRunState(
    config.runStateDir,
    { issueNumber: 45, title: "Resume first", status: "planning" },
    NOW.toISOString(),
  );
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea"
      && call.args[0] === "issues"
      && call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1"
          ? issueListPayload([
            issue(45, ["in-progress", "bug"], "Resume first"),
            issue(46, ["agent-ready", "bug"], "Requested issue"),
          ])
          : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Resumable in-progress automation run #45 exists; resume it before processing #46/,
  );
});

test("runOneIssue allows an explicit resumable issue", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, planOnly: true, issueNumber: 45 });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Resume in-progress issue",
      status: "planning",
      planPath: "docs/plans/2026-05-14-issue-45-resume-in-progress-issue.md",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
      },
    },
    NOW.toISOString(),
  );
  await writeFile(
    join(
      config.repoRoot,
      "docs",
      "plans",
      "2026-05-14-issue-45-resume-in-progress-issue.md",
    ),
    "# plan\n",
    "utf8",
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([issue(45, ["in-progress", "bug"], "Resume in-progress issue")]) : "[]", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-found");
  assert.equal(result.issue.number, 45);
  const editCalls = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 1);
  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 1);
  assert.doesNotMatch(commentBody(comments[0]), /Automation started/);
});

test("runOneIssue does not reuse finished side-effect checkpoints for a fresh selection", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    agentTeam: undefined,
    agentTeamName: undefined,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-finished-plan-only.md";
  await writeFile(
    join(config.plansDir, "2026-05-14-issue-45-finished-plan-only.md"),
    "# plan\n",
    "utf8",
  );
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Finished plan-only",
      status: "finished",
      planPath,
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        readyLabelRestored: true,
        planReadyCommentPosted: true,
        planCreated: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["agent-ready", "bug"], "Finished plan-only")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "blocked");
  const claimCall = runner.calls.find(
    (call) => call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit" && call.args.includes("in-progress"),
  );
  assert.ok(claimCall);
  const startComment = runner.calls.find(
    (call) => call.command === "tea" && call.args[0] === "comment" && /Automation started/.test(commentBody(call)),
  );
  assert.ok(startComment);

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  );
  assert.equal(runState.status, "blocked");
  assert.equal(runState.planPath, planPath);
  assert.deepEqual(runState.checkpoints, {
    claimed: true,
    startedCommentPosted: true,
    planPathResolved: true,
    planCreated: true,
  });
});

test("runOneIssue does not duplicate claim or plan-only comments on resume", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, planOnly: true });
  await writeFile(
    join(config.plansDir, "2026-05-14-issue-45-resume-plan-only.md"),
    "# plan\n",
    "utf8",
  );
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Resume plan only",
      status: "planning",
      planPath: "docs/plans/2026-05-14-issue-45-resume-plan-only.md",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        readyLabelRestored: true,
        planReadyCommentPosted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Resume plan only")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-found");
  assert.equal(result.issue.number, 45);
  assert.equal(
    runner.calls.filter((call) => call.command === "tea" && call.args[0] === "comment").length,
    0,
  );
  assert.equal(
    runner.calls.filter((call) => call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit").length,
    0,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  );
  assert.equal(runState.status, "finished");
  assert.deepEqual(runState.checkpoints, {
    claimed: true,
    startedCommentPosted: true,
    planPathResolved: true,
    readyLabelRestored: true,
    planReadyCommentPosted: true,
  });
});

test("runOneIssue reuses a saved created plan as plan-created in plan-only mode", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, planOnly: true });
  const planPath = "docs/plans/2026-05-14-issue-45-saved-created-plan.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Saved created plan",
      status: "planning",
      planPath,
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planCreated: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress", "bug"], "Saved created plan")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 1);
  assert.match(commentBody(comments[0]), /Plan ready/);
  assert.doesNotMatch(commentBody(comments[0]), /Existing plan ready/);
});

test("runOneIssue stops after finding an existing plan when plan approval is required", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, requirePlanApproval: true });
  const planPath = "docs/plans/2026-05-14-issue-47-approval-existing-plan.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  const selected = issue(47, ["agent-ready", "bug"], "Approval existing plan");
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-found");
  assert.equal(result.planPath, planPath);
  assert.equal(runner.calls.some((call) => call.command === "pi"), false);
  assert.equal(runner.calls.some((call) => call.command === "git" && call.args[0] === "worktree"), false);
  const comments = runner.calls.filter((call) => call.command === "tea" && call.args[0] === "comment");
  assert.equal(comments.length, 2);
  assert.match(commentBody(comments[1]), /Existing plan ready/);
});

test("runOneIssue stops after creating a plan when plan approval is required", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, requirePlanApproval: true });
  const selected = issue(48, ["agent-ready", "bug"], "Approval created plan");
  const expectedPlanPath = "docs/plans/2026-05-09-issue-48-approval-created-plan.md";
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Create an implementation plan/);
      return {
        code: 0,
        stdout: `planning...\n{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"abc123"}`,
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  assert.equal(result.planPath, expectedPlanPath);
  assert.equal(runner.calls.filter((call) => call.command === "pi").length, 1);
  assert.equal(runner.calls.some((call) => call.command === "git" && call.args[0] === "worktree"), false);
  assert.equal(runner.calls.some((call) => call.command === "git" && call.args[0] === "show-ref"), false);
});

test("runOneIssue claims the issue, comments automation start, writes run state, and exits plan-created for plan-only mode", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const selected = issue(
    12,
    ["agent-ready", "bug", "priority:high"],
    "Add once runner pipeline",
  );
  const expectedPlanPath =
    "docs/plans/2026-05-09-issue-12-add-once-runner-pipeline.md";
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "tea" && call.args[0] === "comment") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      assert.equal(call.cwd, config.repoRoot);
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Create an implementation plan/);
      assert.match(
        prompt,
        new RegExp(expectedPlanPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      return {
        code: 0,
        stdout: `planning...\n{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"abc123"}`,
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  assert.equal(result.planPath, expectedPlanPath);
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 2);
  assert.deepEqual(editCalls[0]?.args, withRepo([
    "issues",
    "edit",
    "12",
    "--remove-labels",
    "agent-ready",
    "--add-labels",
    "in-progress",
  ], config.repoRoot));
  assert.deepEqual(editCalls[1]?.args, withRepo([
    "issues",
    "edit",
    "12",
    "--remove-labels",
    "in-progress",
    "--add-labels",
    "agent-ready",
  ], config.repoRoot));
  const addedLabels = editCalls.flatMap((call) => {
    const index = call.args.indexOf("--add-labels");
    return index >= 0 ? [call.args[index + 1]] : [];
  });
  assert.equal(addedLabels.includes("agent-ready"), true);

  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 2);
  assert.match(commentBody(comments[0]), /Automation started/);
  assert.match(commentBody(comments[1]), /Plan ready/);

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 12), "utf8"),
  );
  assert.equal(runState.status, "finished");
  assert.equal(runState.planPath, expectedPlanPath);
  assert.equal(runState.planCommit, "abc123");
  assert.deepEqual(runState.checkpoints, {
    claimed: true,
    startedCommentPosted: true,
    planPathResolved: true,
    planCreated: true,
    readyLabelRestored: true,
    planReadyCommentPosted: true,
  });
  assert.equal(runState.claimedAt, NOW.toISOString());
  assert.equal(runState.planningAt, NOW.toISOString());
  assert.equal(runState.finishedAt, NOW.toISOString());
});

test("runOneIssue plan-only keeps planning resumable when the plan-ready comment fails", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const selected = issue(
    13,
    ["agent-ready", "bug"],
    "Recover plan-only comment failure",
  );
  const expectedPlanPath =
    "docs/plans/2026-05-09-issue-13-recover-plan-only-comment-failure.md";
  let commentCalls = 0;
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "tea" && call.args[0] === "comment") {
      commentCalls += 1;
      return commentCalls === 2
        ? { code: 1, stdout: "", stderr: "comment exploded" }
        : { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout: `planning...\n{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"abc123"}`,
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /tea comment failed for #13: comment exploded/);
  const failedCommentIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "comment" &&
      /Plan ready/.test(commentBody(call)),
  );
  assert.ok(failedCommentIndex >= 0);
  assert.equal(
    runner.calls.filter(
      (call) => call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit",
    ).length,
    1,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 13), "utf8"),
  );
  assert.equal(runState.status, "planning");
  assert.equal(runState.planCommit, "abc123");
  assert.equal(runState.checkpoints.readyLabelRestored, undefined);
  assert.equal(runState.checkpoints.planReadyCommentPosted, undefined);
});

test("runOneIssue reuses existing implementation worktree on resume", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, agentTeam: AGENT_TEAM });
  const planPath = "docs/plans/2026-05-14-issue-45-resume-worktree.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Resume worktree",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-resume-worktree",
      worktreePath: ".worktrees/patchmill-issue-45-resume-worktree",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Resume worktree")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-resume-worktree")}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-resume-worktree\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") {
      return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Resume context:/);
      assert.match(prompt, /abc123 partial work/);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo/pr/45",
          branch: "agent/issue-45-resume-worktree",
          commits: ["abc123"],
          validation: ["just issue-runner-test ok"],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.equal(runner.calls.some((call) => call.command === "git" && call.args.includes("-b")), false);
  assert.ok(runner.calls.find((call) => call.command === "pi"));
});

test("runOneIssue reuses existing implementation result on resume without rerunning pi", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, agentTeam: AGENT_TEAM });
  const planPath = "docs/plans/2026-05-14-issue-45-reuse-implementation.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Reuse implementation",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-reuse-implementation",
      worktreePath: ".worktrees/patchmill-issue-45-reuse-implementation",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/45",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      reviewSummary: "reviewed",
      landingDecision: "PR required: needs manual verification",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Reuse implementation")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-reuse-implementation")}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-reuse-implementation\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(result.prUrl, "https://forgejo/pr/45");
  assert.deepEqual(result.commits, ["abc123"]);
  assert.deepEqual(result.validation, ["just issue-runner-test ok"]);
  assert.equal(result.reviewSummary, "reviewed");
  assert.equal(result.landingDecision, "PR required: needs manual verification");
  assert.equal(runner.calls.some((call) => call.command === "pi"), false);
});

test("runOneIssue finishes saved pr-created handoff without requiring an agent team", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    agentTeam: undefined,
    agentTeamName: undefined,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-complete-pr-created.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Complete PR created",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-complete-pr-created",
      worktreePath: ".worktrees/patchmill-issue-45-complete-pr-created",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/45",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Complete PR created")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-complete-pr-created")}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-complete-pr-created\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(runner.calls.some((call) => call.command === "pi"), false);
  assert.ok(runner.calls.some((call) => call.command === "tea" && call.args[0] === "comment"));
  assert.ok(runner.calls.some((call) => call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit" && call.args.includes("agent-done")));
});

test("runOneIssue resumes and completes saved handoff with configured lifecycle labels", async () => {
  const triagePolicy = createTriagePolicy({
    ...DEFAULT_PATCHMILL_CONFIG.labels,
    inProgress: "claimed",
    done: "completed-by-bot",
    needsInfo: "info-needed",
  });
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    agentTeam: undefined,
    agentTeamName: undefined,
    triagePolicy,
    readyLabel: triagePolicy.labels.ready,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-complete-custom-lifecycle-labels.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Complete custom lifecycle labels",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-complete-custom-lifecycle-labels",
      worktreePath: ".worktrees/patchmill-issue-45-complete-custom-lifecycle-labels",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/45",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1"
          ? issueListPayload([issue(45, ["claimed"], "Complete custom lifecycle labels")])
          : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-complete-custom-lifecycle-labels")}\n`,
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-complete-custom-lifecycle-labels\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") {
      return {
        code: 0,
        stdout: labelListPayload([
          ...DEFAULT_LABEL_NAMES.filter((label) => !["in-progress", "needs-info", "agent-done"].includes(label)),
          "claimed",
          "info-needed",
        ]),
        stderr: "",
      };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "create") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(runner.calls.some((call) => call.command === "pi"), false);
  const doneLabelCreate = runner.calls.find(
    (call) =>
      call.command === "tea"
      && call.args[0] === "labels"
      && call.args[1] === "create"
      && call.args.includes("completed-by-bot"),
  );
  assert.ok(doneLabelCreate);
  const editCalls = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit",
  );
  assert.deepEqual(editCalls[0]?.args, withRepo([
    "issues",
    "edit",
    "45",
    "--remove-labels",
    "claimed",
    "--add-labels",
    "completed-by-bot",
  ], config.repoRoot));
});

test("runOneIssue does not run cleanup commands when cleanup hooks are not configured", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    agentTeam: undefined,
    agentTeamName: undefined,
    worktreePrefix: "patchmill-issue-",
  });
  const planPath = "docs/plans/2026-05-14-issue-45-cleanup-example.md";
  const worktreePath = ".worktrees/patchmill-issue-45-cleanup-example";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(join(worktreeRoot, ".env"), "READY=1\n", "utf8");
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Cleanup Example",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-cleanup-example",
      worktreePath,
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/45",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Cleanup Example")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${worktreeRoot}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-cleanup-example\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "pr-created");
  assert.equal(runner.calls.some((call) => call.command === "bash" && call.args[0] === "-c"), false);
  assert.equal(runner.calls.some((call) => call.command === "npm" && call.args[0] === "run"), false);
  assert.equal(events.some((event) => event.stage === "cleanup"), false);
});

test("runOneIssue runs configured generic cleanup hooks", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    agentTeam: undefined,
    agentTeamName: undefined,
    worktreePrefix: "patchmill-issue-",
    cleanupHooks: [cleanupHook],
  });
  const planPath = "docs/plans/2026-05-14-issue-45-cleanup-example.md";
  const worktreePath = ".worktrees/patchmill-issue-45-cleanup-example";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(join(worktreeRoot, ".env"), "READY=1\n", "utf8");
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Cleanup Example",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-cleanup-example",
      worktreePath,
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/45",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Cleanup Example")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${worktreeRoot}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-cleanup-example\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    if (call.command === "bash" && call.args[0] === "-c" && call.args[3] === worktreeRoot) return { code: 0, stdout: "", stderr: "" };
    if (call.command === "npm" && call.args[0] === "run" && call.args[1] === "cleanup:example" && call.cwd === worktreeRoot) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "pr-created");
  const cleanupCalls = runner.calls.filter(
    (call) =>
      (call.command === "bash" && call.args[0] === "-c") ||
      (call.command === "npm" && call.args[0] === "run"),
  );
  assert.equal(cleanupCalls[0]?.command, "bash");
  assert.equal(cleanupCalls[0]?.args[0], "-c");
  assert.equal(cleanupCalls[0]?.args[2], "example-cleanup");
  assert.equal(cleanupCalls[0]?.args[3], worktreeRoot);
  assert.equal(cleanupCalls[0]?.args[4], "example dev server");
  assert.equal(cleanupCalls[0]?.cwd, config.repoRoot);
  assert.deepEqual(cleanupCalls[1], {
    command: "npm",
    args: ["run", "cleanup:example"],
    cwd: worktreeRoot,
    onStdout: undefined,
    onStderr: undefined,
  });
  assert.ok(
    events.some(
      (event) =>
        event.stage === "cleanup"
        && event.message === "cleanup hook example-cleanup: completed for .worktrees/patchmill-issue-45-cleanup-example",
    ),
  );
});

test("runOneIssue reports cleanup hook failures when process termination is unsafe", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    agentTeam: undefined,
    agentTeamName: undefined,
    worktreePrefix: "patchmill-issue-",
    cleanupHooks: [cleanupHook],
  });
  const planPath = "docs/plans/2026-05-14-issue-45-cleanup-example.md";
  const worktreePath = ".worktrees/patchmill-issue-45-cleanup-example";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(join(worktreeRoot, ".env"), "READY=1\n", "utf8");
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Cleanup Example",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-cleanup-example",
      worktreePath,
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/45",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Cleanup Example")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${worktreeRoot}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-cleanup-example\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    if (call.command === "bash" && call.args[0] === "-c" && call.args[3] === worktreeRoot) {
      return {
        code: 1,
        stdout: "",
        stderr: "Refusing to terminate process group 4321 for cleanup hook example-cleanup because it matches the current cleanup shell process group",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "pr-created");
  assert.equal(runner.calls.some((call) => call.command === "npm" && call.args[0] === "run"), false);
  assert.ok(
    events.some(
      (event) =>
        event.stage === "cleanup"
        && event.level === "error"
        && event.message.includes("cleanup hook example-cleanup: process cleanup failed")
        && event.message.includes("Refusing to terminate process group 4321"),
    ),
  );
});

test("runOneIssue finishes saved merged handoff when direct landing is enabled and skills.landing is configured", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    skills: LANDING_SKILLS,
    agentTeam: undefined,
    agentTeamName: undefined,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-complete-merged.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Complete merged",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-complete-merged",
      worktreePath: ".worktrees/patchmill-issue-45-complete-merged",
      implementationStatus: "merged",
      mergeCommit: "def456",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Complete merged")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-complete-merged")}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-complete-merged\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "merged");
  assert.equal(runner.calls.some((call) => call.command === "pi"), false);
  assert.ok(runner.calls.some((call) => call.command === "tea" && call.args[0] === "comment"));
  assert.ok(runner.calls.some((call) => call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit" && call.args.includes("agent-done")));
});

test("runOneIssue rejects saved merged handoff when skills.landing is not configured", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    agentTeam: undefined,
    agentTeamName: undefined,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-complete-merged.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Complete merged",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-complete-merged",
      worktreePath: ".worktrees/patchmill-issue-45-complete-merged",
      implementationStatus: "merged",
      mergeCommit: "def456",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Complete merged")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-complete-merged")}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-complete-merged\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Saved implementation state returned merged but direct landing requires git\.allowDirectLand=true and configured skills\.landing/,
  );
  assert.equal(runner.calls.some((call) => call.command === "pi"), false);
});

test("runOneIssue rejects saved merged handoff when direct landing is disabled", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    allowDirectLand: false,
    agentTeam: undefined,
    agentTeamName: undefined,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-complete-merged.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Complete merged",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-complete-merged",
      worktreePath: ".worktrees/patchmill-issue-45-complete-merged",
      implementationStatus: "merged",
      mergeCommit: "def456",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Complete merged")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-complete-merged")}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-complete-merged\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Saved implementation state returned merged while git\.allowDirectLand is false/,
  );
  assert.equal(runner.calls.some((call) => call.command === "pi"), false);
});

test("runOneIssue rejects stale finished implementationCompleted state before relabel without an agent team", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    agentTeam: undefined,
    agentTeamName: undefined,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-stale-finished-implementation.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Stale finished implementation",
      status: "finished",
      planPath,
      branch: "agent/issue-45-stale-finished-implementation",
      worktreePath: ".worktrees/patchmill-issue-45-stale-finished-implementation",
      implementationStatus: "merged",
      mergeCommit: "stale123",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
        handoffCommentPosted: true,
        doneLabelEnsured: true,
        doneLabelApplied: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["agent-ready"], "Stale finished implementation")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Non-resumable run state for issue #45 has stale branch\/worktree; clean up before starting a fresh run/,
  );
  assert.equal(runner.calls.some((call) => call.command === "pi"), false);
  assert.equal(runner.calls.some((call) => call.command === "git" && call.args[0] === "worktree"), false);
  assert.equal(runner.calls.some((call) => call.command === "tea" && call.args[0] === "labels"), false);
  assert.equal(runner.calls.some((call) => call.command === "tea" && call.args[0] === "comment"), false);

  const runState = JSON.parse(await readFile(runStatePath(config.runStateDir, 45), "utf8")) as Record<string, unknown> & {
    checkpoints?: Record<string, unknown>;
  };
  assert.equal(runState.status, "finished");
  assert.equal(runState.mergeCommit, "stale123");
  assert.equal(runState.prUrl, undefined);
  assert.equal(runState.checkpoints?.implementationCompleted, true);
  assert.equal(runState.branch, "agent/issue-45-stale-finished-implementation");
  assert.equal(runState.worktreePath, ".worktrees/patchmill-issue-45-stale-finished-implementation");
});

test("runOneIssue rejects stale finished branch and worktree before resetting state", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, agentTeam: AGENT_TEAM });
  const planPath = "docs/plans/2026-05-14-issue-45-stale-finished-same-title.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Stale finished same title",
      status: "finished",
      planPath,
      branch: "agent/issue-45-stale-finished-same-title",
      worktreePath: ".worktrees/patchmill-issue-45-stale-finished-same-title",
      implementationStatus: "merged",
      mergeCommit: "stale123",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["agent-ready"], "Stale finished same title")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Non-resumable run state for issue #45 has stale branch\/worktree; clean up before starting a fresh run/,
  );
  const firstRunState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(firstRunState.status, "finished");
  assert.equal(firstRunState.branch, "agent/issue-45-stale-finished-same-title");
  assert.equal(firstRunState.worktreePath, ".worktrees/patchmill-issue-45-stale-finished-same-title");

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Non-resumable run state for issue #45 has stale branch\/worktree; clean up before starting a fresh run/,
  );

  const secondRunState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(secondRunState.status, "finished");
  assert.equal(secondRunState.branch, "agent/issue-45-stale-finished-same-title");
  assert.equal(secondRunState.worktreePath, ".worktrees/patchmill-issue-45-stale-finished-same-title");

  assert.equal(runner.calls.some((call) => call.command === "pi"), false);
  assert.equal(runner.calls.some((call) => call.command === "git" && call.args[0] === "worktree"), false);
  assert.equal(runner.calls.some((call) => call.command === "tea" && call.args[0] === "comment" && /Unexpected failure/.test(commentBody(call))), false);
  assert.equal(runner.calls.some((call) => call.command === "tea" && call.args[0] === "comment"), false);
  assert.equal(runner.calls.some((call) => call.command === "tea" && call.args[0] === "labels"), false);
});

test("runOneIssue rejects stale finished branch and worktree when title changed", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    agentTeam: undefined,
    agentTeamName: undefined,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-stale-finished-renamed.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Old finished title",
      status: "finished",
      planPath,
      branch: "agent/issue-45-old-finished-title",
      worktreePath: ".worktrees/patchmill-issue-45-old-finished-title",
      implementationStatus: "merged",
      mergeCommit: "stale123",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["agent-ready"], "Renamed finished title")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Non-resumable run state for issue #45 has stale branch\/worktree; clean up before starting a fresh run/,
  );
  assert.equal(runner.calls.some((call) => call.command === "git" && call.args[0] === "worktree"), false);

  const runState = JSON.parse(await readFile(runStatePath(config.runStateDir, 45), "utf8")) as Record<string, unknown>;
  assert.equal(runState.status, "finished");
  assert.equal(runState.branch, "agent/issue-45-old-finished-title");
  assert.equal(runState.worktreePath, ".worktrees/patchmill-issue-45-old-finished-title");
});

test("runOneIssue reruns Pi when implementationCompleted state is missing required saved fields", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, agentTeam: AGENT_TEAM });
  const planPath = "docs/plans/2026-05-14-issue-45-incomplete-implementation-state.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Incomplete implementation state",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-incomplete-implementation-state",
      worktreePath: ".worktrees/patchmill-issue-45-incomplete-implementation-state",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/stale-45",
      commits: ["abc123"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Incomplete implementation state")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-incomplete-implementation-state")}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-incomplete-implementation-state\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Authoritative agent team: economy/);
      assert.match(prompt, /Resume context:/);
      assert.match(prompt, /abc123 partial work/);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo/pr/45",
          branch: "agent/issue-45-incomplete-implementation-state",
          commits: ["def456"],
          validation: ["just issue-runner-test ok"],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(result.prUrl, "https://forgejo/pr/45");
  assert.deepEqual(result.commits, ["def456"]);
  assert.ok(runner.calls.some((call) => call.command === "pi"));
});

test("runOneIssue rejects resumable saved branch/worktree mismatch before worktree commands", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, agentTeam: AGENT_TEAM });
  const planPath = "docs/plans/2026-05-14-issue-45-branch-mismatch.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Old branch mismatch",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-old-branch-mismatch",
      worktreePath: ".worktrees/patchmill-issue-45-old-branch-mismatch",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Branch mismatch")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Saved branch agent\/issue-45-old-branch-mismatch does not match expected branch agent\/issue-45-branch-mismatch/,
  );
  assert.equal(
    runner.calls.some((call) => call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list"),
    false,
  );
  assert.equal(
    runner.calls.some((call) => call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add"),
    false,
  );
  assert.equal(runner.calls.some((call) => call.command === "pi"), false);
  assert.equal(runner.calls.some((call) => call.command === "tea" && call.args[0] === "comment"), false);
});

test("runOneIssue skips handoff and done labels when checkpoints are complete", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, agentTeam: AGENT_TEAM, skills: LANDING_SKILLS });
  const planPath = "docs/plans/2026-05-14-issue-45-finished-handoff.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Finished handoff",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-finished-handoff",
      worktreePath: ".worktrees/patchmill-issue-45-finished-handoff",
      implementationStatus: "merged",
      mergeCommit: "abc999",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
        handoffCommentPosted: true,
        doneLabelEnsured: true,
        doneLabelApplied: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Finished handoff")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-finished-handoff")}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-finished-handoff\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "merged");
  assert.equal(runner.calls.some((call) => call.command === "tea" && call.args[0] === "comment"), false);
  assert.equal(runner.calls.some((call) => call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit"), false);
  assert.equal(runner.calls.some((call) => call.command === "pi"), false);
  const runState = JSON.parse(await readFile(runStatePath(config.runStateDir, 45), "utf8")) as Record<string, unknown> & {
    checkpoints?: Record<string, unknown>;
  };
  assert.equal(runState.status, "finished");
  assert.equal(runState.checkpoints?.doneLabelApplied, true);
});

test("runOneIssue blocks implementation before Pi when no agent team is configured", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    agentTeam: undefined,
    agentTeamName: undefined,
  });
  const selected = issue(14, ["agent-ready", "bug"], "Needs explicit team");
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-14-needs-explicit-team.md",
  );
  await writeFile(existingPlanPath, "# plan\n\n### Task 1: Blocker Task\n", "utf8");
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /Agent team is required for implementation/);
  assert.deepEqual(result.questions, [
    {
      question: "Which agent-team preset should the run-once workflow use for worker and reviewer subagents?",
      recommendedAnswer:
        "Run with --agent-team <name> or set PATCHMILL_AGENT_TEAM=<name> so worker/reviewer model and thinking are explicit.",
    },
  ]);
  assert.equal(runner.calls.some((call) => call.command === "git" && call.args[0] === "worktree"), false);
  assert.equal(runner.calls.some((call) => call.command === "pi"), false);
});

test("runOneIssue replaces stale implementation result fields when Pi changes implementationStatus", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, agentTeam: AGENT_TEAM, skills: LANDING_SKILLS });
  const planPath = "docs/plans/2026-05-14-issue-45-implementation-status-transition.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Implementation status transition",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-implementation-status-transition",
      worktreePath: ".worktrees/patchmill-issue-45-implementation-status-transition",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/stale-45",
      commits: ["abc123"],
      validation: ["stale validation"],
      reviewSummary: "stale review",
      landingDecision: "stale landing",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
      },
    },
    NOW.toISOString(),
  );
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(45, ["in-progress"], "Implementation status transition")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-implementation-status-transition")}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-45-implementation-status-transition\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "merged",
          branch: "agent/issue-45-implementation-status-transition",
          mergeCommit: "def456",
          commits: ["def456"],
          validation: ["just issue-runner-test ok"],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "merged");
  const runState = JSON.parse(await readFile(runStatePath(config.runStateDir, 45), "utf8")) as Record<string, unknown>;
  assert.equal(runState.implementationStatus, "merged");
  assert.equal(runState.mergeCommit, "def456");
  assert.equal(runState.prUrl, undefined);
  assert.equal(runState.reviewSummary, undefined);
  assert.equal(runState.landingDecision, undefined);
});

test("runOneIssue creates a missing plan, then creates a worktree and runs Pi from that worktree", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    15,
    ["agent-ready", "enhancement", "priority:critical"],
    "Ship automation pipeline",
  );
  const expectedPlanPath =
    "docs/plans/2026-05-09-issue-15-ship-automation-pipeline.md";
  let piCalls = 0;
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: labelListPayload(
          DEFAULT_LABEL_NAMES.filter((label) => label !== "agent-done"),
        ),
        stderr: "",
      };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "worktree") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      piCalls += 1;
      const prompt = await readFile(promptPath(call.args), "utf8");
      if (piCalls === 1) {
        const finalText = `created plan\n{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"abc123"}`;
        await writePiSessionMessage(call, "plan output\n", {
          input: 10000,
          output: 500,
          totalTokens: 10500,
        });
        assert.equal(call.cwd, config.repoRoot);
        assert.match(prompt, /Create an implementation plan/);
        return { code: 0, stdout: finalText, stderr: "" };
      }

      assert.equal(
        call.cwd,
        join(
          config.repoRoot,
          ".worktrees/patchmill-issue-15-ship-automation-pipeline",
        ),
      );
      const finalText = `done\n{"status":"pr-created","prUrl":"https://forgejo.example/pr/15","branch":"agent/issue-15-ship-automation-pipeline","commits":["def456"],"validation":["node --test ok"],"reviewSummary":"reviewed"}`;
      await writePiSessionMessage(call, "implementation output\n", {
        input: 20000,
        output: 1000,
        totalTokens: 21000,
      });
      assert.match(prompt, /Implement repository issue #15/);
      assertNoLegacyProjectText(prompt);
      assert.match(prompt, /Branch: agent\/issue-15-ship-automation-pipeline/);
      assert.match(prompt, /Authoritative agent team: economy/);
      assert.match(prompt, /worker: model=openai-codex\/gpt-5\.4, thinking=medium/);
      assert.match(prompt, /reviewer: model=openai-codex\/gpt-5\.5, thinking=high/);
      return { code: 0, stdout: finalText, stderr: "" };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const logPath = join(config.runStateDir, "run.jsonl");
  const streamedPiOutput: string[] = [];
  const result = await runOneIssue(runner, config, {
    now: NOW,
    progress,
    logPath,
    streamPiOutput: (chunk) => streamedPiOutput.push(chunk),
  });

  assert.equal(result.status, "pr-created");
  assert.equal(result.logPath, logPath);
  const stepLabels = events.flatMap((event) => event.step?.type === "step-start" ? [event.step.label] : []);
  assert.ok(stepLabels.includes("select issue"), stepLabels.join("\n"));
  assert.ok(stepLabels.includes("commit plan"), stepLabels.join("\n"));
  assert.ok(stepLabels.includes("create worktree"), stepLabels.join("\n"));
  assert.ok(stepLabels.includes("final result pr-created"), stepLabels.join("\n"));
  assert.deepEqual(
    events
      .filter((event) => event.level !== "debug" && event.stage !== "step" && event.stage !== "run")
      .map((event) => event.message),
    [
      "listing open issues",
      "selected #15 Ship automation pipeline",
      "checking repository status",
      "ensuring in-progress label exists",
      "claimed #15: agent-ready -> in-progress",
      "finding plan",
      "creating plan with pi",
      "creating worktree .worktrees/patchmill-issue-15-ship-automation-pipeline",
      "running implementation with pi",
      "PR created: https://forgejo.example/pr/15",
    ],
  );
  assert.equal(result.planPath, expectedPlanPath);
  assert.equal(result.branch, "agent/issue-15-ship-automation-pipeline");
  assert.equal(
    result.worktreePath,
    ".worktrees/patchmill-issue-15-ship-automation-pipeline",
  );
  assert.equal(result.prUrl, "https://forgejo.example/pr/15");
  assert.equal(piCalls, 2);
  assert.deepEqual(streamedPiOutput, []);

  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 2);
  assert.deepEqual(editCalls[0]?.args, withRepo([
    "issues",
    "edit",
    "15",
    "--remove-labels",
    "agent-ready",
    "--add-labels",
    "in-progress",
  ], config.repoRoot));
  assert.deepEqual(editCalls[1]?.args, withRepo([
    "issues",
    "edit",
    "15",
    "--remove-labels",
    "in-progress",
    "--add-labels",
    "agent-done",
  ], config.repoRoot));

  const doneLabelCreate = runner.calls.find(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create" &&
      call.args.includes("agent-done"),
  );
  assert.ok(doneLabelCreate);

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 15), "utf8"),
  );
  assert.equal(runState.status, "finished");
  assert.equal(runState.planPath, expectedPlanPath);
  assert.equal(runState.planCommit, "abc123");
  assert.equal(runState.branch, "agent/issue-15-ship-automation-pipeline");
  assert.equal(
    runState.worktreePath,
    ".worktrees/patchmill-issue-15-ship-automation-pipeline",
  );
  assert.equal(runState.implementingAt, NOW.toISOString());
});

test("runOneIssue renders configured project policy visual evidence fields in the implementation prompt", async () => {
  const baseConfig = await makeConfig({ dryRun: false, execute: true });
  const config = {
    ...baseConfig,
    baseBranch: "release/2.0",
    remote: "upstream",
    skills: {
      ...baseConfig.skills,
      visualEvidence: "sentinel-screenshots",
      landing: "sentinel-landing",
    },
    projectPolicy: {
      ...DEFAULT_PATCHMILL_POLICY,
      projectName: "Sentinel",
      directLand: {
        targetBranch: "ignored-by-runner",
      },
      visualEvidence: {
        referenceScreenshotPaths: ["docs/sentinel/web/", "docs/sentinel/mobile/"],
        prEvidenceExample: {
          screenshotPath: ".tmp/issue-42-sentinel-after.png",
          caption: "Sentinel after the change",
          referencePaths: ["docs/sentinel/web/hero.png"],
        },
      },
    },
  };
  const selected = issue(16, ["agent-ready"], "Render configured policy prompt");
  const planPath = "docs/plans/2026-05-09-issue-16-render-configured-policy-prompt.md";
  const worktreeRoot = join(config.repoRoot, ".worktrees/patchmill-issue-16-render-configured-policy-prompt");

  let piCalls = 0;
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([selected]) : "[]", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref") return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      piCalls += 1;
      const prompt = await readFile(promptPath(call.args), "utf8");
      if (piCalls === 1) {
        assert.match(prompt, /Create an implementation plan for Sentinel issue #16/);
        return {
          code: 0,
          stdout: `{"status":"plan-created","planPath":"${planPath}","commit":"abc123"}`,
          stderr: "",
        };
      }

      await writeTodo(worktreeRoot, "task-1", "issue-16-task-01-render-configured-policy-prompt", "closed");
      assert.match(prompt, /Implement Sentinel issue #16/);
      assert.match(prompt, /If the issue changes visible UI, use the configured visual evidence skill: `sentinel-screenshots`\./);
      assert.match(prompt, /Use the configured landing skill for the direct-land versus PR decision: `sentinel-landing`\./);
      assert.match(prompt, /Look under `docs\/sentinel\/web\/` and `docs\/sentinel\/mobile\/`/);
      assert.match(prompt, /"screenshotPath": "\.tmp\/issue-42-sentinel-after\.png"/);
      assert.match(prompt, /Update local `release\/2\.0` from the `upstream` remote\./);
      assert.doesNotMatch(prompt, /capturing proof screenshots|Reviewer must confirm Sentinel screenshot approval|policyText|webScreenshotSkill|mobileScreenshotSkill/);
      assertNoLegacyProjectText(prompt);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/16",
          branch: "agent/issue-16-render-configured-policy-prompt",
          commits: ["def456"],
          validation: ["node --test ok"],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(piCalls, 2);
});

test("runOneIssue uses the configured worktree strategy for workspace names and prompt instructions", async () => {
  const baseConfig = await makeConfig({ dryRun: false, execute: true });
  const config = {
    ...baseConfig,
    baseBranch: "release/1.2",
    baseRef: "refs/remotes/upstream/release/1.2",
    remote: "upstream",
    skills: {
      ...baseConfig.skills,
      landing: "project-landing",
    },
    branchPrefix: "patchmill/issue-",
    worktreeDir: join(baseConfig.repoRoot, ".patchmill", "worktrees"),
    worktreePrefix: "pm-issue-",
  };
  const selected = issue(16, ["agent-ready"], "Use custom worktrees");
  const planPath = join(config.plansDir, "2026-05-09-issue-16-use-custom-worktrees.md");
  await writeFile(planPath, "# Plan\n", "utf8");

  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([selected]) : "[]", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref") return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") {
      assert.deepEqual(call.args, [
        "worktree",
        "add",
        "-b",
        "patchmill/issue-16-use-custom-worktrees",
        ".patchmill/worktrees/pm-issue-16-use-custom-worktrees",
        "refs/remotes/upstream/release/1.2",
      ]);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      const promptPath = call.args.at(-1)?.slice(1);
      assert.ok(promptPath);
      const prompt = await readFile(promptPath, "utf8");
      assert.match(prompt, /Branch: patchmill\/issue-16-use-custom-worktrees/);
      assert.match(prompt, /Worktree: \.patchmill\/worktrees\/pm-issue-16-use-custom-worktrees/);
      assert.match(prompt, /Update local `release\/1\.2` from the `upstream` remote\./);
      assert.match(prompt, /Push `release\/1\.2` to `upstream` without force-pushing\./);
      assert.match(prompt, /Push the branch to `upstream` and open a pull request using the repository's configured host tooling\./);
      assert.equal(call.cwd, join(config.repoRoot, ".patchmill/worktrees/pm-issue-16-use-custom-worktrees"));
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/16",
          branch: "patchmill/issue-16-use-custom-worktrees",
          commits: ["abc123"],
          validation: ["node --test ok"],
        }),
        stderr: "",
      };
    }

    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(result.branch, "patchmill/issue-16-use-custom-worktrees");
  assert.equal(result.worktreePath, ".patchmill/worktrees/pm-issue-16-use-custom-worktrees");
  const runState = JSON.parse(await readFile(runStatePath(config.runStateDir, 16), "utf8")) as Record<string, unknown>;
  assert.equal(runState.branch, "patchmill/issue-16-use-custom-worktrees");
  assert.equal(runState.worktreePath, ".patchmill/worktrees/pm-issue-16-use-custom-worktrees");
});

test("runOneIssue ignores configured run-state logs during the clean-worktree check", async () => {
  const baseConfig = await makeConfig({ dryRun: false, execute: true });
  const config = {
    ...baseConfig,
    runStateDir: join(baseConfig.repoRoot, ".patchmill", "runs"),
  };
  const selected = issue(17, ["agent-ready"], "Ignore configured run logs");
  const planPath = join(config.plansDir, "2026-05-09-issue-17-ignore-configured-run-logs.md");
  await writeFile(planPath, "# Plan\n", "utf8");

  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([selected]) : "[]", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status") {
      return {
        code: 0,
        stdout: "?? .patchmill/runs/run-2026-05-09T12-00-00-000Z.jsonl\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "show-ref") return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/17",
          branch: "agent/issue-17-ignore-configured-run-logs",
          commits: ["abc123"],
          validation: ["node --test ok"],
        }),
        stderr: "",
      };
    }

    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, {
    now: NOW,
    logPath: join(config.runStateDir, "run-2026-05-09T12-00-00-000Z.jsonl"),
  });

  assert.equal(result.status, "pr-created");
  assert.equal(result.worktreePath, ".worktrees/patchmill-issue-17-ignore-configured-run-logs");
});

test("runOneIssue ignores the default Pi todo root during the clean-worktree check", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(18, ["agent-ready"], "Ignore default task todos");
  const planPath = join(config.plansDir, "2026-05-09-issue-18-ignore-default-task-todos.md");
  await writeFile(planPath, "# Plan\n", "utf8");

  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([selected]) : "[]", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status") {
      return {
        code: 0,
        stdout: "?? .pi/todos/issue-18-task-01-date-range-model.md\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "show-ref") return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/18",
          branch: "agent/issue-18-ignore-default-task-todos",
          commits: ["abc123"],
          validation: ["node --test ok"],
        }),
        stderr: "",
      };
    }

    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(result.worktreePath, ".worktrees/patchmill-issue-18-ignore-default-task-todos");
});

test("runOneIssue ignores a custom Pi todo root during the clean-worktree check", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    projectPolicy: {
      ...DEFAULT_PATCHMILL_POLICY,
      pi: {
        ...DEFAULT_PATCHMILL_POLICY.pi,
        taskContract: {
          ...DEFAULT_PATCHMILL_POLICY.pi.taskContract,
          todoRoot: ".patchmill/todos",
        },
      },
    },
  });
  const selected = issue(19, ["agent-ready"], "Ignore custom task todos");
  const planPath = join(config.plansDir, "2026-05-09-issue-19-ignore-custom-task-todos.md");
  await writeFile(planPath, "# Plan\n", "utf8");

  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([selected]) : "[]", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status") {
      return {
        code: 0,
        stdout: "?? .patchmill/todos/work-19-step-01-date-range-model.md\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "show-ref") return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/19",
          branch: "agent/issue-19-ignore-custom-task-todos",
          commits: ["abc123"],
          validation: ["node --test ok"],
        }),
        stderr: "",
      };
    }

    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(result.worktreePath, ".worktrees/patchmill-issue-19-ignore-custom-task-todos");
});

test("runOneIssue ignores a custom Pi todo root when reusing an existing worktree", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    projectPolicy: {
      ...DEFAULT_PATCHMILL_POLICY,
      pi: {
        ...DEFAULT_PATCHMILL_POLICY.pi,
        taskContract: {
          ...DEFAULT_PATCHMILL_POLICY.pi.taskContract,
          todoRoot: ".patchmill/todos",
        },
      },
    },
  });
  const selected = issue(20, ["agent-ready"], "Reuse custom task todos");
  const worktreeRoot = join(config.repoRoot, ".worktrees/patchmill-issue-20-reuse-custom-task-todos");
  const planPath = join(config.plansDir, "2026-05-09-issue-20-reuse-custom-task-todos.md");
  await writeFile(planPath, "# Plan\n", "utf8");

  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([selected]) : "[]", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status") {
      return {
        code: 0,
        stdout: call.cwd === worktreeRoot
          ? "?? .patchmill/todos/work-20-step-01-date-range-model.md\n"
          : "",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${worktreeRoot}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-20-reuse-custom-task-todos\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/20",
          branch: "agent/issue-20-reuse-custom-task-todos",
          commits: ["abc123"],
          validation: ["node --test ok"],
        }),
        stderr: "",
      };
    }

    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(result.worktreePath, ".worktrees/patchmill-issue-20-reuse-custom-task-todos");
  assert.equal(
    runner.calls.some((call) => call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add"),
    false,
  );
});

test("runOneIssue honors configured clean-status ignore prefixes", async () => {
  const baseConfig = await makeConfig({ dryRun: false, execute: true });
  const config = {
    ...baseConfig,
    runStateDir: join(baseConfig.repoRoot, ".patchmill", "runs"),
    cleanStatusIgnorePrefixes: ["scratch-logs/"],
  };
  const selected = issue(18, ["agent-ready"], "Ignore configured scratch logs");
  const planPath = join(config.plansDir, "2026-05-09-issue-18-ignore-configured-scratch-logs.md");
  await writeFile(planPath, "# Plan\n", "utf8");

  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([selected]) : "[]", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status") {
      return {
        code: 0,
        stdout: "?? scratch-logs/run-2026-05-09T12-00-00-000Z.jsonl\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "show-ref") return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/18",
          branch: "agent/issue-18-ignore-configured-scratch-logs",
          commits: ["abc123"],
          validation: ["node --test ok"],
        }),
        stderr: "",
      };
    }

    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, {
    now: NOW,
    logPath: join(config.runStateDir, "run-2026-05-09T12-00-00-000Z.jsonl"),
  });

  assert.equal(result.status, "pr-created");
  assert.equal(result.worktreePath, ".worktrees/patchmill-issue-18-ignore-configured-scratch-logs");
});

test("runOneIssue implementation heartbeat reads task progress from the issue worktree", async () => {
  const selected = issue(14, ["agent-ready"], "Progress Root");
  const config = await makeConfig({ dryRun: false, execute: true });
  const planPath = join(config.plansDir, "2026-05-09-issue-14-progress-root.md");
  await writeFile(planPath, "# Plan\n", "utf8");

  const worktreePath = ".worktrees/patchmill-issue-14-progress-root";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  for (let index = 1; index <= 8; index += 1) {
    await writeTodo(
      config.repoRoot,
      `main-${index}`,
      `issue-14-task-${String(index).padStart(2, "0")}-planned`,
      "completed",
    );
  }

  let finishRun: (result: CommandResult) => void = () => undefined;
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([selected]) : "[]", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") {
      for (let index = 1; index <= 8; index += 1) {
        await writeTodo(
          worktreeRoot,
          `worktree-${index}`,
          `issue-14-task-${String(index).padStart(2, "0")}-planned`,
          index < 7 ? "closed" : "open",
        );
      }
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return new Promise<CommandResult>((resolve) => {
        finishRun = resolve;
      });
    }

    if (call.command === "tea") {
      return { code: 0, stdout: "", stderr: "" };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const run = runOneIssue(runner, config, {
    now: NOW,
    progress,
    heartbeatMs: 10,
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  finishRun({
    code: 0,
    stdout:
      '{"status":"pr-created","prUrl":"https://forgejo.example/pr/14","branch":"agent/issue-14-progress-root","commits":[],"validation":[]}',
    stderr: "",
  });
  await run;

  assert.ok(
    events.some(
      (event) =>
        event.level === "heartbeat" &&
        event.message.includes("implementing task 7/8"),
    ),
    events.map((event) => event.message).join("\n"),
  );
});

test("runOneIssue emits visible implementation subtask step labels", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const planPath = join(config.plansDir, "2026-05-22-issue-15-ship-automation-pipeline.md");
  await writeFile(
    planPath,
    [
      "# Ship Automation Pipeline Implementation Plan",
      "",
      "### Task 1: Date Range Model",
      "",
      "### Task 2: Dashboard Wiring",
    ].join("\n"),
    "utf8",
  );

  const worktreePath = ".worktrees/patchmill-issue-15-ship-automation-pipeline";
  const worktreeRoot = join(config.repoRoot, worktreePath);

  let implementationCall: Call | undefined;
  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([issue(15, ["agent-ready"], "Ship automation pipeline")]) : "[]", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref") return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      implementationCall = call;
      await writeTodo(worktreeRoot, "task-1", "issue-15-task-01-date-range-model", "closed");
      await writeTodo(worktreeRoot, "task-2", "issue-15-task-02-dashboard-wiring", "closed");
      await writePiSessionMessage(call, "done", { input: 999999, output: 2200, totalTokens: 999999 });
      return {
        code: 0,
        stdout: '{"status":"pr-created","prUrl":"https://forgejo.example/pr/15","branch":"agent/issue-15-ship-automation-pipeline","commits":["def456"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress, heartbeatMs: 1 });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.ok(implementationCall);
  const labels = events.flatMap((event) => event.step?.type === "step-start" ? [event.step.label] : []);
  assert.ok(labels.includes("implement task 1/2 date range model"), labels.join("\n"));
  assert.ok(labels.includes("implement task 2/2 dashboard wiring"), labels.join("\n"));
  assert.equal(labels.includes("implement issue"), false);
});

test("runOneIssue moves streamed tool calls under the active implementation task", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, agentTeam: AGENT_TEAM });
  const planPath = join(config.plansDir, "2026-05-22-issue-77-agent-output.md");
  await writeFile(
    planPath,
    [
      "# Agent Output Plan",
      "",
      "### Task 1: First Cycle",
      "",
      "### Task 2: Second Cycle",
      "",
      "### Task 3: Third Cycle",
    ].join("\n"),
    "utf8",
  );

  const worktreePath = ".worktrees/patchmill-issue-77-agent-output";
  const worktreeRoot = join(config.repoRoot, worktreePath);

  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([issue(77, ["agent-ready"], "Agent output")]) : "[]", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref") return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      await writeTodo(worktreeRoot, "task-1", "issue-77-task-01-first-cycle", "in-progress");
      await writeTodo(worktreeRoot, "task-2", "issue-77-task-02-second-cycle", "open");
      await writeTodo(worktreeRoot, "task-3", "issue-77-task-03-third-cycle", "open");
      await initializePiSession(call);

      await appendPiSessionEntry(call, assistantToolCall("call-1", "subagent", { agent: "worker" }));
      await delay(150);

      await writeTodo(worktreeRoot, "task-1", "issue-77-task-01-first-cycle", "closed");
      await writeTodo(worktreeRoot, "task-2", "issue-77-task-02-second-cycle", "in-progress");
      await appendPiSessionEntry(call, assistantToolCall("call-2", "subagent", { agent: "worker" }));
      await delay(150);

      await writeTodo(worktreeRoot, "task-2", "issue-77-task-02-second-cycle", "closed");
      await writeTodo(worktreeRoot, "task-3", "issue-77-task-03-third-cycle", "in-progress");
      await appendPiSessionEntry(call, assistantToolCall("call-3", "subagent", { agent: "worker" }));
      await delay(150);

      await writeTodo(worktreeRoot, "task-3", "issue-77-task-03-third-cycle", "closed");
      await appendPiSessionEntry(call, assistantToolCall("call-4", "subagent", { agent: "reviewer" }));
      await delay(150);

      return {
        code: 0,
        stdout: '{"status":"pr-created","prUrl":"https://forgejo.example/pr/77","branch":"agent/issue-77-agent-output","commits":["def456"],"validation":["ok"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress, heartbeatMs: 10_000 });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  const rendered = events.map((event) => {
    if (event.step?.type === "step-start") return `start:${event.step.label}`;
    if (event.step?.type === "step-complete") return `complete:${event.step.label}`;
    if (event.observation?.type === "tool-call" && event.observation.toolName === "subagent") return `tool:${event.observation.toolCallId}`;
    return undefined;
  }).filter((line): line is string => line !== undefined);

  assert.deepEqual(rendered.filter((line) => line.startsWith("start:implement task") || line.startsWith("complete:implement task") || line === "start:final review and landing" || line === "complete:final review and landing" || line.startsWith("tool:call-")), [
    "start:implement task 1/3 first cycle",
    "tool:call-1",
    "complete:implement task 1/3 first cycle",
    "start:implement task 2/3 second cycle",
    "tool:call-2",
    "complete:implement task 2/3 second cycle",
    "start:implement task 3/3 third cycle",
    "tool:call-3",
    "complete:implement task 3/3 third cycle",
    "start:final review and landing",
    "tool:call-4",
    "complete:final review and landing",
  ]);
});

test("runOneIssue uploads visual evidence to the PR before posting the issue handoff", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, agentTeam: AGENT_TEAM });
  const planPath = join(config.plansDir, "2026-05-22-issue-31-dashboard-visual-evidence.md");
  await writeFile(planPath, "# plan\n", "utf8");
  const worktreePath = ".worktrees/patchmill-issue-31-dashboard-visual-evidence";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  const commentBodies: string[] = [];
  const uploadCalls: Array<{ repoRoot: string; prUrl: string; evidence: unknown }> = [];

  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([issue(31, ["agent-ready"], "Dashboard visual evidence")]) : "[]", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment") {
      commentBodies.push(commentBody(call));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref") return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      await writeTodo(worktreeRoot, "task-1", "issue-31-task-01-dashboard-visual-evidence", "closed");
      await mkdir(join(worktreeRoot, ".tmp"), { recursive: true });
      await writeFile(join(worktreeRoot, ".tmp", "dashboard.png"), MINIMAL_PNG_BYTES);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
          branch: "agent/issue-31-dashboard-visual-evidence",
          commits: ["def456"],
          validation: ["just playwright-test ok"],
          reviewSummary: "Fresh reviewer screenshot review: passed",
          visualEvidence: [
            {
              screenshotPath: ".tmp/dashboard.png",
              caption: "Dashboard after selecting last 8 weeks",
              referencePaths: ["docs/visual-baselines/web/01-dashboard.png"],
            },
          ],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const visualEvidenceUploader = {
    async uploadPrEvidence(input: { repoRoot: string; prUrl: string; evidence: Array<{ screenshotPath: string; caption?: string; referencePaths?: string[] }> | undefined }) {
      uploadCalls.push(input);
      return input.evidence?.map((entry) => ({ ...entry, url: "https://forgejo.example/attachments/dashboard.png" })) ?? [];
    },
  };

  const result = await runOneIssue(runner, config, {
    now: NOW,
    visualEvidenceUploader,
  });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.deepEqual(uploadCalls, [
    {
      repoRoot: worktreeRoot,
      prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
      evidence: [
        {
          screenshotPath: ".tmp/dashboard.png",
          caption: "Dashboard after selecting last 8 weeks",
          referencePaths: ["docs/visual-baselines/web/01-dashboard.png"],
        },
      ],
    },
  ]);
  assert.match(commentBodies.find((body) => body.includes("Automation handoff ready")) ?? "", /PR: https:\/\/forgejo\.example\/owner\/patchmill\/pulls\/77/);
  assert.equal(commentBodies.some((body) => body.includes(".tmp/dashboard.png") && body.includes("Visual evidence")), false);
});

test("runOneIssue keeps visual evidence when no uploader is configured", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, agentTeam: AGENT_TEAM });
  const planPath = join(config.plansDir, "2026-05-22-issue-32-dashboard-visual-evidence.md");
  await writeFile(planPath, "# plan\n", "utf8");
  const worktreePath = ".worktrees/patchmill-issue-32-dashboard-visual-evidence";
  const worktreeRoot = join(config.repoRoot, worktreePath);

  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([issue(32, ["agent-ready"], "Dashboard visual evidence without uploader")]) : "[]", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref") return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      await writeTodo(worktreeRoot, "task-1", "issue-32-task-01-dashboard-visual-evidence", "closed");
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/owner/patchmill/pulls/88",
          branch: "agent/issue-32-dashboard-visual-evidence",
          commits: ["def456"],
          validation: ["just playwright-test ok"],
          reviewSummary: "Fresh reviewer screenshot review: passed",
          visualEvidence: [
            {
              screenshotPath: ".tmp/dashboard.png",
              caption: "Dashboard after selecting last 8 weeks",
              referencePaths: ["docs/visual-baselines/web/01-dashboard.png"],
            },
          ],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.deepEqual(result.visualEvidence, [
    {
      screenshotPath: ".tmp/dashboard.png",
      caption: "Dashboard after selecting last 8 weeks",
      referencePaths: ["docs/visual-baselines/web/01-dashboard.png"],
    },
  ]);
  assert.ok(
    events.some((event) => event.stage === "visual-evidence" && event.message === "visual evidence present but no uploader configured; skipping host asset upload"),
    JSON.stringify(events, null, 2),
  );
});

test("runOneIssue keeps implementation task totals anchored to the plan when transient todos differ", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const planPath = join(config.plansDir, "2026-05-22-issue-19-dashboard-date-ranges.md");
  await writeFile(
    planPath,
    [
      "# Dashboard Date Ranges Implementation Plan",
      "",
      "### Task 1: Dashboard Range Primitives",
      "",
      "### Task 2: Aggregate Range Threading",
      "",
      "### Task 3: Render Global Filter UI",
      "",
      "### Task 4: Playwright Coverage",
      "",
      "### Task 5: Final Verification Cleanup",
    ].join("\n"),
    "utf8",
  );

  const worktreePath = ".worktrees/patchmill-issue-19-dashboard-date-ranges";
  const worktreeRoot = join(config.repoRoot, worktreePath);

  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return { code: 0, stdout: page === "1" ? issueListPayload([issue(19, ["agent-ready"], "Dashboard date ranges")]) : "[]", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref") return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      await writeTodo(worktreeRoot, "task-1", "issue-19-task-01-dashboard-range-primitives", "open");
      await writeTodo(worktreeRoot, "task-2", "issue-19-task-02-aggregate-range-threading", "open");
      await writeTodo(worktreeRoot, "task-3", "issue-19-task-03-render-global-filter-ui", "open");
      await writeTodo(worktreeRoot, "task-4", "issue-19-task-04-dashboard-csv-excel-exports", "open");
      await writeTodo(worktreeRoot, "task-5", "issue-19-task-05-playwright-coverage", "open");
      await writeTodo(worktreeRoot, "task-6", "issue-19-task-06-final-verification-cleanup", "open");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeTodo(worktreeRoot, "task-1", "issue-19-task-01-dashboard-range-primitives", "closed");
      await writeTodo(worktreeRoot, "task-2", "issue-19-task-02-aggregate-range-threading", "closed");
      await writeTodo(worktreeRoot, "task-3", "issue-19-task-03-render-global-filter-ui", "closed");
      await writeTodo(worktreeRoot, "task-4", "issue-19-task-04-playwright-coverage", "closed");
      await writeTodo(worktreeRoot, "task-5", "issue-19-task-05-final-verification-cleanup", "closed");
      await writeTodo(worktreeRoot, "task-6", "issue-19-task-06-final-verification-cleanup", "closed");
      await writePiSessionMessage(call, "done", { input: 999999, output: 2200, totalTokens: 999999 });
      return {
        code: 0,
        stdout: '{"status":"pr-created","prUrl":"https://forgejo.example/pr/19","branch":"agent/issue-19-dashboard-date-ranges","commits":["def456"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress, heartbeatMs: 1 });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  const labels = events.flatMap((event) => event.step?.type === "step-start" ? [event.step.label] : []);
  assert.ok(labels.includes("implement task 1/5 dashboard range primitives"), labels.join("\n"));
  assert.ok(labels.includes("implement task 5/5 final verification cleanup"), labels.join("\n"));
  assert.equal(labels.some((label) => label.includes("/6")), false, labels.join("\n"));
});

test("runOneIssue resolves a named agent team when using an existing plan", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    agentTeam: undefined,
    agentTeamName: "economy",
  });
  const selected = issue(
    21,
    ["agent-ready", "bug"],
    "Fix isolated issue runner",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-21-fix-isolated-issue-runner.md",
  );
  await writeFile(existingPlanPath, "# plan\n", "utf8");
  const teamDir = join(config.repoRoot, ".pi", "agent-teams");
  await mkdir(teamDir, { recursive: true });
  await writeFile(
    join(teamDir, "economy.json"),
    JSON.stringify({
      name: "economy",
      agents: {
        worker: { model: "openai-codex/gpt-5.4", thinking: "medium" },
        reviewer: { model: "openai-codex/gpt-5.5", thinking: "high" },
      },
    }),
    "utf8",
  );
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (
      call.command === "git" &&
      (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      assert.equal(
        call.cwd,
        join(
          config.repoRoot,
          ".worktrees/patchmill-issue-21-fix-isolated-issue-runner",
        ),
      );
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(
        prompt,
        /Read AGENTS\.md and the implementation plan at docs\/plans\/2026-05-01-issue-21-fix-isolated-issue-runner\.md/,
      );
      assert.match(prompt, /Authoritative agent team: economy/);
      assert.match(prompt, /worker: model=openai-codex\/gpt-5\.4, thinking=medium/);
      assert.match(prompt, /reviewer: model=openai-codex\/gpt-5\.5, thinking=high/);
      return {
        code: 0,
        stdout:
          '{"status":"pr-created","prUrl":"https://forgejo.example/pr/21","branch":"agent/issue-21-fix-isolated-issue-runner","commits":["123abc"],"validation":["just test ok"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(
    result.planPath,
    "docs/plans/2026-05-01-issue-21-fix-isolated-issue-runner.md",
  );
  assert.equal(runner.calls.filter((call) => call.command === "pi").length, 1);
});

test("runOneIssue blocks completed handoff when issue task todos remain open", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    23,
    ["agent-ready", "bug"],
    "Reject stale todo progress",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-23-reject-stale-todo-progress.md",
  );
  const worktreePath = ".worktrees/patchmill-issue-23-reject-stale-todo-progress";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(existingPlanPath, "# plan\n", "utf8");
  await writeTodo(
    worktreeRoot,
    "task-1",
    "issue-23-task-01-server-duplicate-guard",
    "open",
  );
  await writeTodo(
    worktreeRoot,
    "task-2",
    "issue-23-task-02-mobile-confirmation",
    "done",
  );

  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree" && call.args[1] === "list") {
      return { code: 0, stdout: `worktree ${worktreeRoot}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-23-reject-stale-todo-progress\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"pr-created","prUrl":"https://forgejo.example/pr/23","branch":"agent/issue-23-reject-stale-todo-progress","commits":["abc123"],"validation":["git diff --check ok"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /Issue task todos remain open/);
  assert.match(result.reason, /issue-23-task-01-server-duplicate-guard/);
  const state = JSON.parse(await readFile(runStatePath(config.runStateDir, 23), "utf8"));
  assert.equal(state.status, "implementing");
  assert.match(state.lastError, /Issue task todos remain open/);
  assert.equal(
    runner.calls.some((call) => call.command === "npm" && call.args[0] === "run" && call.args[1] === "cleanup:example"),
    false,
  );
  assert.equal(
    runner.calls.some((call) => call.command === "tea" && call.args[0] === "issues" && call.args.includes("agent-done")),
    false,
  );
});

test("runOneIssue accepts direct squash-landed implementation results when skills.landing is configured", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, skills: LANDING_SKILLS });
  const selected = issue(22, ["agent-ready", "bug"], "Fix direct landing");
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-22-fix-direct-landing.md",
  );
  await writeFile(existingPlanPath, "# plan\n\n### Task 1: Blocker Task\n", "utf8");
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (
      call.command === "git" &&
      (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"merged","branch":"agent/issue-22-fix-direct-landing","mergeCommit":"abc999","commits":["def456"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed","landingDecision":"direct squash-landed: simple localized bug fix"}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "merged");
  assert.equal(result.mergeCommit, "abc999");
  assert.equal(result.branch, "agent/issue-22-fix-direct-landing");
  assert.equal(
    result.planPath,
    "docs/plans/2026-05-01-issue-22-fix-direct-landing.md",
  );
  assert.equal(
    result.worktreePath,
    ".worktrees/patchmill-issue-22-fix-direct-landing",
  );
  assert.deepEqual(result.validation, ["just issue-runner-test ok"]);
  assert.equal(result.reviewSummary, "reviewed");
  assert.equal(
    result.landingDecision,
    "direct squash-landed: simple localized bug fix",
  );
  assert.ok(
    events.some((event) => event.message === "Merged to main: abc999"),
  );

  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 2);
  assert.deepEqual(editCalls[1]?.args, withRepo([
    "issues",
    "edit",
    "22",
    "--remove-labels",
    "in-progress",
    "--add-labels",
    "agent-done",
  ], config.repoRoot));

  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 2);
  assert.match(commentBody(comments[1]), /Merged to `main`: abc999/);
  assert.match(
    commentBody(comments[1]),
    /direct squash-landed: simple localized bug fix/,
  );
  assert.match(commentBody(comments[1]), /just issue-runner-test ok/);
});

test("runOneIssue rejects Pi merged results when skills.landing is not configured", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(22, ["agent-ready", "bug"], "Fix direct landing");
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-22-fix-direct-landing.md",
  );
  await writeFile(existingPlanPath, "# plan\n\n### Task 1: Blocker Task\n", "utf8");
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (
      call.command === "git" &&
      (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"merged","branch":"agent/issue-22-fix-direct-landing","mergeCommit":"abc999","commits":["def456"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed","landingDecision":"direct squash-landed: simple localized bug fix"}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Pi returned merged but direct landing requires git\.allowDirectLand=true and configured skills\.landing/,
  );
});

test("runOneIssue rejects Pi merged results when direct landing is disabled", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, allowDirectLand: false });
  const selected = issue(22, ["agent-ready", "bug"], "Fix direct landing");
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-22-fix-direct-landing.md",
  );
  await writeFile(existingPlanPath, "# plan\n\n### Task 1: Blocker Task\n", "utf8");
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (
      call.command === "git" &&
      (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"merged","branch":"agent/issue-22-fix-direct-landing","mergeCommit":"abc999","commits":["def456"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed","landingDecision":"direct squash-landed: simple localized bug fix"}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Pi returned merged while git\.allowDirectLand is false/,
  );
});

test("runOneIssue marks deterministic blockers as needs-info without restoring agent-ready", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    31,
    ["agent-ready", "enhancement"],
    "Clarify pipeline blocker path",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-31-clarify-pipeline-blocker-path.md",
  );
  await writeFile(existingPlanPath, "# plan\n\n### Task 1: Blocker Task\n", "utf8");
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (
      call.command === "git" &&
      (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"blocked","reason":"Need API ownership decision","questions":[{"question":"Which API should own the runner output?","recommendedAnswer":"Keep ownership in the existing triage package to avoid duplicating adapters."}],"commits":["789fed"],"validation":["tests not run"]}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "Need API ownership decision");
  const stepEvents = events
    .filter((event) => event.step)
    .map((event) => `${event.step?.type}:${event.step && "label" in event.step ? event.step.label : event.message}`);
  const taskComplete = stepEvents.indexOf("step-complete:implement task 1/1 blocker task");
  const finalStart = stepEvents.indexOf("step-start:final result blocked");
  assert.ok(taskComplete >= 0, stepEvents.join("\n"));
  assert.ok(finalStart > taskComplete, stepEvents.join("\n"));
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.deepEqual(editCalls[1]?.args, withRepo([
    "issues",
    "edit",
    "31",
    "--remove-labels",
    "in-progress",
    "--add-labels",
    "needs-info",
  ], config.repoRoot));
  assert.equal(
    editCalls.some(
      (call) => call.args.includes("agent-ready") && call !== editCalls[0],
    ),
    false,
  );

  const blockerComment = runner.calls
    .filter((call) => call.command === "tea" && call.args[0] === "comment")
    .at(-1);
  assert.ok(blockerComment);
  assert.match(commentBody(blockerComment), /Automation blocked/);
  assert.match(commentBody(blockerComment), /needs more information/i);
  assert.match(
    commentBody(blockerComment),
    /Which API should own the runner output\?/,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 31), "utf8"),
  );
  assert.equal(runState.status, "blocked");
  assert.equal(runState.lastError, "Need API ownership decision");
});

test("runOneIssue uses configured claim and blocker labels", async () => {
  const triagePolicy = createTriagePolicy({
    ...DEFAULT_PATCHMILL_CONFIG.labels,
    inProgress: "claimed",
    done: "completed-by-bot",
    needsInfo: "info-needed",
  });
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    triagePolicy,
    readyLabel: triagePolicy.labels.ready,
  });
  const selected = issue(
    32,
    [triagePolicy.labels.ready, "enhancement"],
    "Clarify custom lifecycle labels",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-32-clarify-custom-lifecycle-labels.md",
  );
  await writeFile(existingPlanPath, "# plan\n\n### Task 1: Blocker Task\n", "utf8");
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea"
      && call.args[0] === "issues"
      && call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (
      call.command === "git"
      && (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea"
      && call.args[0] === "labels"
      && call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: labelListPayload(
          DEFAULT_LABEL_NAMES.filter((label) => !["in-progress", "needs-info", "agent-done"].includes(label)),
        ),
        stderr: "",
      };
    }

    if (
      call.command === "tea"
      && call.args[0] === "labels"
      && call.args[1] === "create"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea"
      && (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"blocked","reason":"Need API ownership decision","questions":[{"question":"Which API should own the runner output?","recommendedAnswer":"Keep ownership in the existing triage package to avoid duplicating adapters."}],"commits":["789fed"],"validation":["tests not run"]}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  const claimedLabelCreate = runner.calls.find(
    (call) =>
      call.command === "tea"
      && call.args[0] === "labels"
      && call.args[1] === "create"
      && call.args.includes("claimed"),
  );
  assert.ok(claimedLabelCreate);
  const editCalls = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit",
  );
  assert.deepEqual(editCalls[0]?.args, withRepo([
    "issues",
    "edit",
    "32",
    "--remove-labels",
    triagePolicy.labels.ready,
    "--add-labels",
    "claimed",
  ], config.repoRoot));
  assert.deepEqual(editCalls[1]?.args, withRepo([
    "issues",
    "edit",
    "32",
    "--remove-labels",
    "claimed",
    "--add-labels",
    "info-needed",
  ], config.repoRoot));
});

test("runOneIssue ensures a missing configured blocker label before applying it", async () => {
  const triagePolicy = createTriagePolicy({
    ...DEFAULT_PATCHMILL_CONFIG.labels,
    needsInfo: "info-needed",
  });
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    triagePolicy,
    readyLabel: triagePolicy.labels.ready,
  });
  const selected = issue(
    33,
    [triagePolicy.labels.ready, "enhancement"],
    "Create missing blocker label before applying it",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-33-create-missing-blocker-label-before-applying-it.md",
  );
  await writeFile(existingPlanPath, "# plan\n\n### Task 1: Blocker Task\n", "utf8");
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea"
      && call.args[0] === "issues"
      && call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (
      call.command === "git"
      && (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea"
      && call.args[0] === "labels"
      && call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: labelListPayload(DEFAULT_LABEL_NAMES.filter((label) => label !== "needs-info")),
        stderr: "",
      };
    }

    if (
      call.command === "tea"
      && call.args[0] === "labels"
      && call.args[1] === "create"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea"
      && (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"blocked","reason":"Need API ownership decision","questions":[{"question":"Which API should own the runner output?","recommendedAnswer":"Keep ownership in the existing triage package to avoid duplicating adapters."}],"commits":["789fed"],"validation":["tests not run"]}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  const blockerLabelCreateIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea"
      && call.args[0] === "labels"
      && call.args[1] === "create"
      && call.args.includes("info-needed"),
  );
  const blockerEditIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea"
      && call.args[0] === "issues"
      && call.args[1] === "edit"
      && call.args.includes("info-needed"),
  );
  assert.ok(blockerLabelCreateIndex >= 0);
  assert.ok(blockerEditIndex > blockerLabelCreateIndex);
  assert.deepEqual(runner.calls[blockerLabelCreateIndex]?.args, withRepo([
    "labels",
    "create",
    "--name",
    "info-needed",
    "--color",
    "#8957e5",
    "--description",
    "Needs reporter information or human decision before planning",
  ], config.repoRoot));
  assert.deepEqual(runner.calls[blockerEditIndex]?.args, withRepo([
    "issues",
    "edit",
    "33",
    "--remove-labels",
    triagePolicy.labels.inProgress,
    "--add-labels",
    "info-needed",
  ], config.repoRoot));
});

test("runOneIssue records and comments unexpected planning failures without replacing in-progress", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    41,
    ["agent-ready", "bug"],
    "Handle planning failure state",
  );
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "tea" && call.args[0] === "comment") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return { code: 1, stdout: "", stderr: "model unavailable" };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const logPath = join(config.runStateDir, "run.jsonl");
  const result = await runOneIssue(runner, config, {
    now: NOW,
    progress,
    logPath,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.logPath, logPath);
  assert.match(result.reason, /pi failed: model unavailable/);
  assert.ok(
    events.some(
      (event) =>
        event.level === "error" &&
        event.message === "blocked: pi failed: model unavailable",
    ),
  );
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 1);

  const failureComment = runner.calls
    .filter((call) => call.command === "tea" && call.args[0] === "comment")
    .at(-1);
  assert.ok(failureComment);
  assert.match(commentBody(failureComment), /Automation failed unexpectedly/);
  assert.match(commentBody(failureComment), /remains in-progress/);
  assert.match(commentBody(failureComment), /model unavailable/);

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 41), "utf8"),
  );
  assert.equal(runState.status, "planning");
  assert.match(runState.lastError, /pi failed: model unavailable/);
  assert.equal(
    runState.planPath,
    "docs/plans/2026-05-09-issue-41-handle-planning-failure-state.md",
  );

  const resumeRunner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1"
          ? issueListPayload([
              issue(41, ["in-progress", "bug"], "Handle planning failure state"),
              issue(99, ["agent-ready", "bug"], "Do not select me"),
            ])
          : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "edit") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      return {
        code: 0,
        stdout: '{"status":"plan-created","planPath":"docs/plans/2026-05-09-issue-41-handle-planning-failure-state.md","commit":"abc123"}',
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const resumed = await runOneIssue(resumeRunner, { ...config, planOnly: true }, { now: NOW });

  assert.equal(resumed.status, "plan-created");
  assert.equal(resumed.issue.number, 41);
});

test("runOneIssue records and comments unexpected implementation failures without replacing in-progress", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    42,
    ["agent-ready", "enhancement"],
    "Handle implementation parse failure",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-42-handle-implementation-parse-failure.md",
  );
  await writeFile(existingPlanPath, "# plan\n", "utf8");
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (
      call.command === "git" &&
      (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return { code: 0, stdout: '{"status":"unknown"}', stderr: "" };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /supported final JSON status/);
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 1);

  const failureComment = runner.calls
    .filter((call) => call.command === "tea" && call.args[0] === "comment")
    .at(-1);
  assert.ok(failureComment);
  assert.match(commentBody(failureComment), /Automation failed unexpectedly/);
  assert.match(commentBody(failureComment), /remains in-progress/);
  assert.match(commentBody(failureComment), /supported final JSON status/);

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 42), "utf8"),
  );
  assert.equal(runState.status, "implementing");
  assert.equal(
    runState.planPath,
    "docs/plans/2026-05-01-issue-42-handle-implementation-parse-failure.md",
  );
  assert.equal(
    runState.branch,
    "agent/issue-42-handle-implementation-parse-failure",
  );
  assert.equal(
    runState.worktreePath,
    ".worktrees/patchmill-issue-42-handle-implementation-parse-failure",
  );
  assert.match(runState.lastError, /supported final JSON status/);

  const resumeRunner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1"
          ? issueListPayload([
              issue(42, ["in-progress", "enhancement"], "Handle implementation parse failure"),
              issue(100, ["agent-ready", "bug"], "Do not select me either"),
            ])
          : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree") {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-42-handle-implementation-parse-failure")}\n`,
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-42-handle-implementation-parse-failure\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") {
      return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "tea" && (call.args[0] === "issues" || call.args[0] === "comment")) return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo/pr/42",
          branch: "agent/issue-42-handle-implementation-parse-failure",
          commits: ["abc123"],
          validation: ["just issue-runner-test ok"],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const resumed = await runOneIssue(resumeRunner, config, { now: NOW });

  assert.equal(resumed.status, "pr-created");
  assert.equal(resumed.issue.number, 42);
});

test("runOneIssue does not duplicate unexpected planning failure comments on rerun and still updates lastError", async () => {
  const config = await makeConfig({ dryRun: false, execute: true, planOnly: true });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 61,
      title: "Retry planning failure",
      status: "planning",
      planPath: "docs/plans/2026-05-09-issue-61-retry-planning-failure.md",
      checkpoints: { claimed: true, startedCommentPosted: true, planPathResolved: true },
      failureCommentKeys: ["unexpected-failure:planning"],
      lastError: "old planning error",
    },
    "2026-05-09T11:55:00.000Z",
  );

  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(61, ["in-progress", "bug"], "Retry planning failure")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "pi") return { code: 1, stdout: "", stderr: "different planning failure" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.equal(
    runner.calls.some((call) => call.command === "tea" && call.args[0] === "comment"),
    false,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 61), "utf8"),
  );
  assert.equal(runState.status, "planning");
  assert.equal(runState.lastError, "pi failed: different planning failure");
  assert.deepEqual(runState.failureCommentKeys, ["unexpected-failure:planning"]);
});

test("runOneIssue does not duplicate unexpected implementation failure comments on rerun and still updates lastError", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const planPath = join(
    config.plansDir,
    "2026-05-09-issue-62-retry-implementation-failure.md",
  );
  await writeFile(planPath, "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 62,
      title: "Retry implementation failure",
      status: "implementing",
      planPath: "docs/plans/2026-05-09-issue-62-retry-implementation-failure.md",
      branch: "agent/issue-62-retry-implementation-failure",
      worktreePath: ".worktrees/patchmill-issue-62-retry-implementation-failure",
      checkpoints: { claimed: true, startedCommentPosted: true, planPathResolved: true, worktreeReady: true },
      failureCommentKeys: ["unexpected-failure:implementing"],
      lastError: "old implementation error",
    },
    "2026-05-09T11:55:00.000Z",
  );

  const runner = createMockRunner(async (call) => {
    if (call.command === "tea" && call.args[0] === "issues" && call.args[1] === "list") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(62, ["in-progress", "bug"], "Retry implementation failure")]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree") {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-62-retry-implementation-failure")}\n`,
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "-C" && call.args[2] === "branch") {
      return { code: 0, stdout: "agent/issue-62-retry-implementation-failure\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (call.command === "tea" && call.args[0] === "labels" && call.args[1] === "list") return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "pi") return { code: 0, stdout: '{"status":"unknown"}', stderr: "" };
    throw new Error(`unexpected command: ${call.command} ${call.args.join(" ")}`);
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.equal(
    runner.calls.some((call) => call.command === "tea" && call.args[0] === "comment"),
    false,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 62), "utf8"),
  );
  assert.equal(runState.status, "implementing");
  assert.match(runState.lastError, /supported final JSON status/);
  assert.deepEqual(runState.failureCommentKeys, ["unexpected-failure:implementing"]);
});

test("runOneIssue records unexpected start-comment failures after claim", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    43,
    ["agent-ready", "bug"],
    "Handle start comment failure",
  );
  let commentCalls = 0;
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "tea" && call.args[0] === "comment") {
      commentCalls += 1;
      return commentCalls === 1
        ? { code: 1, stdout: "", stderr: "start exploded" }
        : { code: 0, stdout: "", stderr: "" };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /tea comment failed for #43: start exploded/);
  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 2);
  assert.match(commentBody(comments[1]), /Automation failed unexpectedly/);

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 43), "utf8"),
  );
  assert.equal(runState.status, "claimed");
  assert.match(
    runState.lastError,
    /tea comment failed for #43: start exploded/,
  );
});

test("runOneIssue preserves blocked state when blocker comment fails", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    44,
    ["agent-ready", "enhancement"],
    "Preserve blocker state on comment failure",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-44-preserve-blocker-state-on-comment-failure.md",
  );
  await writeFile(existingPlanPath, "# plan\n", "utf8");
  let commentCalls = 0;
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (
      call.command === "git" &&
      (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "tea" && call.args[0] === "comment") {
      commentCalls += 1;
      return commentCalls === 2
        ? { code: 1, stdout: "", stderr: "blocker comment exploded" }
        : { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"blocked","reason":"Need product decision","questions":["Which variant should automation implement first?"],"commits":[],"validation":[]}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "Need product decision");
  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 2);
  assert.equal(
    comments.some((call) =>
      /Automation failed unexpectedly/.test(commentBody(call)),
    ),
    false,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 44), "utf8"),
  );
  assert.equal(runState.status, "blocked");
  assert.equal(runState.lastError, "Need product decision");
});

test("runOneIssue creates the in-progress label before claiming when Forgejo is missing it", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const selected = issue(
    45,
    ["agent-ready", "bug"],
    "Ensure in-progress label exists",
  );
  const expectedPlanPath =
    "docs/plans/2026-05-09-issue-45-ensure-in-progress-label-exists.md";
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: labelListPayload(
          DEFAULT_LABEL_NAMES.filter((label) => label !== "in-progress"),
        ),
        stderr: "",
      };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "tea" && call.args[0] === "comment") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout: `planning...\n{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"abc123"}`,
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  const createIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create",
  );
  const claimIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.ok(createIndex >= 0);
  assert.ok(claimIndex > createIndex);
  assert.deepEqual(runner.calls[createIndex]?.args, withRepo([
    "labels",
    "create",
    "--name",
    "in-progress",
    "--color",
    "#fbca04",
    "--description",
    "Issue is currently being processed by automation",
  ], config.repoRoot));
});
