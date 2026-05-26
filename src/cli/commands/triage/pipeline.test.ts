import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import { createStaticCommandRunner } from "../../../../test-support/command-runner.ts";
import { formatResultLines, HELP_TEXT } from "./main.ts";
import { runTriage } from "./pipeline.ts";

const issueJson = JSON.stringify([
  {
    index: 1,
    title: "Needs info",
    body: "Broken",
    state: "open",
    labels: [{ name: "bug" }],
  },
]);

const noCommentsOutput = { code: 0, stdout: "", stderr: "" };

function previewJson(previews: unknown[]): string {
  return JSON.stringify({ previews });
}

const needsInfoPreviewJson = previewJson([
  {
    issueNumber: 1,
    currentLabels: ["bug"],
    proposedLabels: ["needs-info", "bug"],
    canonicalBucket: "needs-info",
    rationale: "Missing reproduction details.",
    wouldComment: "What exact steps reproduce the issue?",
    wouldClose: false,
    questions: ["What exact steps reproduce the issue?"],
  },
]);

function agentReadyPreviewJson(issueNumber: number): string {
  return previewJson([
    {
      issueNumber,
      currentLabels: ["bug"],
      proposedLabels: ["bug", "agent-ready"],
      canonicalBucket: "agent-ready",
      rationale: "Clear issue ready for the planning workflow.",
      wouldComment: null,
      wouldClose: false,
      questions: [],
    },
  ]);
}

test("runTriage dry-run previews configured skill without mutating Forgejo", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: needsInfoPreviewJson, stderr: "" },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    logDir,
  });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.mutationStatus, "preview");
  assert.equal(result.issues[0]?.primaryBucket, "needs-info");
  assert.equal(
    runner.calls.some((call) => call.args.includes("create")),
    false,
  );
  assert.equal(
    runner.calls.some((call) => call.args.includes("edit")),
    false,
  );
  const piCall = runner.calls.find((call) => call.command === "pi");
  assert.ok(piCall?.args.includes("--tools"));
  const log = JSON.parse(await readFile(result.logPath, "utf8"));
  assert.equal(log.mode, "dry-run");
  assert.deepEqual(result.issues, log.issues);
});

test("HELP_TEXT documents usage and active triage protection wording", () => {
  assert.match(HELP_TEXT, /Usage:/);
  assert.match(HELP_TEXT, /--help/);
  assert.match(HELP_TEXT, /-h/);
  assert.doesNotMatch(HELP_TEXT, /--execute/);
  assert.match(HELP_TEXT, /executes the configured triage skill by default/);
  assert.match(HELP_TEXT, /--dry-run/);
  assert.match(HELP_TEXT, /--issue <number>/);
  assert.match(HELP_TEXT, /--all/);
  assert.match(HELP_TEXT, /without active triage or protection labels/);
  assert.match(
    HELP_TEXT,
    /including issues already carrying triage or protection labels such as in-progress or blocked/,
  );
});

test("formatResultLines prints dry-run previews and observed changes", () => {
  const dryRunLines = formatResultLines({
    status: "dry-run",
    issueCount: 1,
    logPath: "/tmp/triage.json",
    issues: [
      {
        issueNumber: 1,
        title: "Needs info",
        previousLabels: ["bug"],
        finalLabels: ["bug", "needs-info"],
        primaryBucket: "needs-info",
        rationale: "Missing reproduction details.",
        questions: ["What exact steps reproduce the issue?"],
        comment: "What exact steps reproduce the issue?",
        mutationStatus: "preview",
      },
    ],
  });

  assert.deepEqual(dryRunLines, [
    "#1 needs-info preview",
    "  labels: bug -> bug, needs-info",
    "  comment: What exact steps reproduce the issue?",
  ]);

  const executeLines = formatResultLines({
    status: "applied",
    issueCount: 1,
    logPath: "/tmp/triage.json",
    issues: [
      {
        issueNumber: 2,
        title: "Ready",
        previousLabels: ["needs-triage"],
        finalLabels: ["ready-for-agent"],
        primaryBucket: "agent-ready",
        questions: [],
        comment: "## Agent Brief",
        addedComments: ["## Agent Brief"],
        previousState: "open",
        finalState: "open",
        mutationStatus: "observed",
      },
    ],
  });

  assert.deepEqual(executeLines, [
    "#2 agent-ready observed",
    "  labels: needs-triage -> ready-for-agent",
    "  comment: ## Agent Brief",
  ]);
});

test("runTriage executes configured skill by default and reports observed changes", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const beforeIssueJson = JSON.stringify([
    {
      index: 1,
      title: "Needs triage",
      body: "Broken",
      state: "open",
      labels: [{ name: "bug" }],
    },
  ]);
  const afterIssueJson = JSON.stringify([
    {
      index: 1,
      title: "Needs triage",
      body: "Broken",
      state: "open",
      labels: [{ name: "ready-for-agent" }, { name: "bug" }],
    },
  ]);
  const runner = createStaticCommandRunner([
    { code: 0, stdout: beforeIssueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: "triaged", stderr: "" },
    { code: 0, stdout: afterIssueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    {
      code: 0,
      stdout:
        "## Comments\n**@bot** wrote on 2026-05-25 12:00:\n## Agent Brief\nImplement the fix.\n--------\n",
      stderr: "",
    },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: false,
    execute: true,
    issueNumber: 1,
    logDir,
    triagePolicy: createTriagePolicy(
      {
        ...DEFAULT_PATCHMILL_CONFIG.labels,
        ready: "ready-for-agent",
      },
      {
        stateMap: {
          "ready-for-agent": "agent-ready",
          "needs-info": "needs-info",
          "agent-unsuitable": "agent-unsuitable",
        },
      },
    ),
  });

  assert.equal(result.status, "applied");
  assert.equal(result.issues[0]?.mutationStatus, "observed");
  assert.equal(result.issues[0]?.primaryBucket, "agent-ready");
  assert.deepEqual(result.issues[0]?.previousLabels, ["bug"]);
  assert.deepEqual(result.issues[0]?.finalLabels, ["bug", "ready-for-agent"]);
  assert.equal(result.issues[0]?.comment, "## Agent Brief\nImplement the fix.");
  assert.equal(
    runner.calls.some(
      (call) => call.args.includes("labels") && call.args.includes("create"),
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.args.includes("issues") && call.args.includes("edit"),
    ),
    false,
  );
});

test("runTriage passes explicit tea login to Forgejo commands only", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const afterIssueJson = JSON.stringify([
    {
      index: 1,
      title: "Needs info",
      body: "Broken",
      state: "open",
      labels: [{ name: "agent-ready" }, { name: "bug" }],
    },
  ]);
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: "triaged", stderr: "" },
    { code: 0, stdout: afterIssueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
  ]);

  await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: false,
    execute: true,
    issueNumber: 1,
    logDir,
    teaLogin: "triage-agent",
  });

  const teaCalls = runner.calls.filter((call) => call.command === "tea");
  assert.ok(teaCalls.length > 0);
  assert.ok(
    teaCalls.every(
      (call) =>
        call.args.includes("--login") && call.args.includes("triage-agent"),
    ),
  );
  const piCall = runner.calls.find((call) => call.command === "pi");
  assert.ok(piCall);
  assert.equal(piCall.args.includes("triage-agent"), false);
});

test("runTriage passes configured custom skills through to the triage agent", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = {
    calls: [] as Array<{ command: string; args: string[]; cwd?: string }>,
    async run(command: string, args: string[], options = {}) {
      runner.calls.push({ command, args: [...args], cwd: options.cwd });

      if (
        command === "tea" &&
        args.includes("issues") &&
        args.includes("list")
      ) {
        const page = args[args.indexOf("--page") + 1];
        return {
          code: 0,
          stdout: page === "1" ? issueJson : JSON.stringify([]),
          stderr: "",
        };
      }

      if (command === "tea" && args.includes("--comments")) {
        return noCommentsOutput;
      }

      if (command === "pi") {
        assert.equal(args.includes("--skill"), false);
        const promptPath = args[args.indexOf("-p") + 1]?.slice(1);
        assert.ok(promptPath);
        const prompt = await readFile(promptPath, "utf8");
        assert.match(
          prompt,
          /Use the configured triage skill: `project-triage`\./,
        );
        return { code: 0, stdout: needsInfoPreviewJson, stderr: "" };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  };

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    logDir,
    skills: {
      triage: "project-triage",
      planning: "superpowers:writing-plans",
      implementation: "superpowers:subagent-driven-development",
    },
  });

  assert.equal(result.status, "dry-run");
  assert.ok(runner.calls.some((call) => call.command === "pi"));
});

test("runTriage execute passes configured state map to the Pi prompt", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const beforeIssueJson = JSON.stringify([
    {
      index: 1,
      title: "Needs triage",
      body: "Broken",
      state: "open",
      labels: [{ name: "bug" }],
    },
  ]);
  const afterIssueJson = JSON.stringify([
    {
      index: 1,
      title: "Needs triage",
      body: "Broken",
      state: "open",
      labels: [{ name: "ship-it" }, { name: "bug" }],
    },
  ]);
  const runner = {
    calls: [] as Array<{ command: string; args: string[]; cwd?: string }>,
    async run(command: string, args: string[], options = {}) {
      runner.calls.push({ command, args: [...args], cwd: options.cwd });

      if (
        command === "tea" &&
        args.includes("issues") &&
        args.includes("list")
      ) {
        const page = args[args.indexOf("--page") + 1];
        if (page) {
          return {
            code: 0,
            stdout: page === "1" ? beforeIssueJson : JSON.stringify([]),
            stderr: "",
          };
        }
        return { code: 0, stdout: afterIssueJson, stderr: "" };
      }

      if (command === "tea" && args.includes("--comments")) {
        return noCommentsOutput;
      }

      if (command === "pi") {
        const promptPath = args[args.indexOf("-p") + 1]?.slice(1);
        assert.ok(promptPath);
        const prompt = await readFile(promptPath, "utf8");
        assert.match(prompt, /Configured triage state map:/);
        assert.match(prompt, /"ship-it": "agent-ready"/);
        assert.match(prompt, /"awaiting-reporter": "needs-info"/);
        assert.match(prompt, /"manual-only": "agent-unsuitable"/);
        return { code: 0, stdout: "triaged", stderr: "" };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  };

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: false,
    execute: true,
    issueNumber: 1,
    logDir,
    triagePolicy: createTriagePolicy(
      {
        ...DEFAULT_PATCHMILL_CONFIG.labels,
        ready: "ship-it",
        needsInfo: "awaiting-reporter",
        unsuitable: "manual-only",
      },
      {
        stateMap: {
          "ship-it": "agent-ready",
          "awaiting-reporter": "needs-info",
          "manual-only": "agent-unsuitable",
        },
      },
    ),
  });

  assert.equal(result.status, "applied");
  assert.ok(runner.calls.some((call) => call.command === "pi"));
});

test("runTriage applies limit after listing open issues", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const twoIssues = JSON.stringify([
    { index: 1, title: "One", body: "", state: "open", labels: [] },
    { index: 2, title: "Two", body: "", state: "open", labels: [] },
  ]);
  const runner = createStaticCommandRunner([
    { code: 0, stdout: twoIssues, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    {
      code: 0,
      stdout: previewJson([
        {
          issueNumber: 1,
          currentLabels: [],
          proposedLabels: ["agent-unsuitable"],
          canonicalBucket: "agent-unsuitable",
          rationale: "Not actionable for automation.",
          wouldComment: null,
          wouldClose: false,
          questions: [],
        },
      ]),
      stderr: "",
    },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    limit: 1,
    logDir,
  });

  assert.equal(result.issueCount, 1);
});

test("runTriage skips already triaged open issues by default before applying limit", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const mixedIssues = JSON.stringify([
    {
      index: 1,
      title: "Already ready",
      body: "Clear",
      state: "open",
      labels: [{ name: "agent-ready" }],
    },
    {
      index: 2,
      title: "Already blocked",
      body: "Needs decision",
      state: "open",
      labels: [{ name: "needs-info" }],
    },
    {
      index: 3,
      title: "Untriaged",
      body: "Broken",
      state: "open",
      labels: [{ name: "bug" }],
    },
  ]);
  const runner = createStaticCommandRunner([
    { code: 0, stdout: mixedIssues, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: agentReadyPreviewJson(3), stderr: "" },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    limit: 1,
    logDir,
  });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 3);
});

test("runTriage skips in-progress issues by default before applying limit", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const mixedIssues = JSON.stringify([
    {
      index: 1,
      title: "Claimed",
      body: "Already being worked",
      state: "open",
      labels: [{ name: "in-progress" }],
    },
    {
      index: 2,
      title: "Untriaged",
      body: "Broken",
      state: "open",
      labels: [{ name: "bug" }],
    },
  ]);
  const runner = createStaticCommandRunner([
    { code: 0, stdout: mixedIssues, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: agentReadyPreviewJson(2), stderr: "" },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    limit: 1,
    logDir,
  });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 2);
});

test("runTriage skips blocked issues by default before applying limit", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const mixedIssues = JSON.stringify([
    {
      index: 1,
      title: "Blocked",
      body: "Waiting on dependency",
      state: "open",
      labels: [{ name: "blocked" }],
    },
    {
      index: 2,
      title: "Untriaged",
      body: "Broken",
      state: "open",
      labels: [{ name: "bug" }],
    },
  ]);
  const runner = createStaticCommandRunner([
    { code: 0, stdout: mixedIssues, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: agentReadyPreviewJson(2), stderr: "" },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    limit: 1,
    logDir,
  });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 2);
});

test("runTriage --all includes in-progress issues for recovery", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const triagedIssue = JSON.stringify([
    {
      index: 1,
      title: "Claimed",
      body: "Already being worked",
      state: "open",
      labels: [{ name: "in-progress" }],
    },
  ]);
  const runner = createStaticCommandRunner([
    { code: 0, stdout: triagedIssue, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: agentReadyPreviewJson(1), stderr: "" },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    all: true,
    logDir,
  });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 1);
});

test("runTriage targeted issue overrides the in-progress default skip", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const triagedIssue = JSON.stringify([
    {
      index: 1,
      title: "Claimed",
      body: "Already being worked",
      state: "open",
      labels: [{ name: "in-progress" }],
    },
  ]);
  const runner = createStaticCommandRunner([
    { code: 0, stdout: triagedIssue, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: agentReadyPreviewJson(1), stderr: "" },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    issueNumber: 1,
    logDir,
  });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 1);
});

test("runTriage writes a failure log before rethrowing execute agent errors", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 1, stdout: "", stderr: "triage exploded" },
  ]);

  await assert.rejects(() =>
    runTriage(runner, {
      repoRoot: "/repo",
      dryRun: false,
      execute: true,
      logDir,
    }),
  );

  const files = await readdir(logDir);
  assert.equal(files.length, 1);
  const log = JSON.parse(await readFile(join(logDir, files[0]!), "utf8"));
  assert.equal(log.mode, "execute");
  assert.equal(log.issues.length, 0);
  assert.match(log.error, /triage exploded/);
});

test("runTriage writes a failure log when preview validation fails", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: JSON.stringify({ previews: [] }), stderr: "" },
  ]);

  await assert.rejects(
    () =>
      runTriage(runner, {
        repoRoot: "/repo",
        dryRun: true,
        execute: false,
        logDir,
      }),
    /Expected 1 previews but received 0/,
  );

  const files = await readdir(logDir);
  assert.equal(files.length, 1);
  const log = JSON.parse(await readFile(join(logDir, files[0]!), "utf8"));
  assert.equal(log.mode, "dry-run");
  assert.equal(log.issues.length, 0);
  assert.match(log.error, /Expected 1 previews but received 0/);
});

test("runTriage writes a failure log when execute snapshot listing fails", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: "triaged", stderr: "" },
    { code: 1, stdout: "", stderr: "snapshot exploded" },
  ]);

  await assert.rejects(
    () =>
      runTriage(runner, {
        repoRoot: "/repo",
        dryRun: false,
        execute: true,
        logDir,
      }),
    /snapshot exploded/,
  );

  const files = await readdir(logDir);
  assert.equal(files.length, 1);
  const log = JSON.parse(await readFile(join(logDir, files[0]!), "utf8"));
  assert.equal(log.mode, "execute");
  assert.equal(log.issues.length, 0);
  assert.match(log.error, /snapshot exploded/);
});

test("runTriage rejects targeted issues that are not open or not found and logs the error", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
  ]);

  await assert.rejects(
    () =>
      runTriage(runner, {
        repoRoot: "/repo",
        dryRun: true,
        execute: false,
        issueNumber: 123,
        logDir,
      }),
    /Issue #123 is not open or was not found/,
  );

  const files = await readdir(logDir);
  assert.equal(files.length, 1);
  const log = JSON.parse(await readFile(join(logDir, files[0]!), "utf8"));
  assert.equal(log.mode, "dry-run");
  assert.equal(log.issues.length, 0);
  assert.match(log.error, /Issue #123 is not open or was not found/);
});
