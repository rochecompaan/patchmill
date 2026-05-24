import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatResultLines, HELP_TEXT } from "../agent-issue-triage.ts";
import { createStaticCommandRunner } from "./command.ts";
import { REQUIRED_LABELS } from "./labels.ts";
import { runTriage } from "./pipeline.ts";

const issueJson = JSON.stringify([
  { index: 1, title: "Needs info", body: "Broken", state: "open", labels: [{ name: "bug" }] },
]);

const allLabelsJson = JSON.stringify(REQUIRED_LABELS.map((label) => ({ name: label.name })));
const labelsMissingNeedsInfoJson = JSON.stringify(
  REQUIRED_LABELS
    .filter((label) => label.name !== "needs-info")
    .map((label) => ({ name: label.name })),
);
const noCommentsOutput = { code: 0, stdout: "", stderr: "" };

const needsInfoDecisionJson = JSON.stringify({ decisions: [{
  issueNumber: 1,
  primaryBucket: "needs-info",
  labels: ["bug", "needs-info", "priority:medium"],
  confidence: "medium",
  rationale: "Missing reproduction details.",
  questions: ["What exact steps reproduce the issue?"],
  comment: null,
}] });

test("runTriage dry-run validates and logs without mutating Forgejo", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: allLabelsJson, stderr: "" },
    { code: 0, stdout: needsInfoDecisionJson, stderr: "" },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    logDir,
  });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issueCount, 1);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.issueNumber, 1);
  assert.equal(result.issues[0]?.primaryBucket, "needs-info");
  assert.equal(runner.calls.some((call) => call.args.includes("create")), false);
  assert.equal(runner.calls.some((call) => call.args.includes("edit")), false);
  const log = JSON.parse(await readFile(result.logPath, "utf8"));
  assert.equal(log.mode, "dry-run");
  assert.equal(log.issues[0].mutationStatus, "planned");
  assert.deepEqual(result.issues, log.issues);
});

test("HELP_TEXT documents usage and active triage protection wording", () => {
  assert.match(HELP_TEXT, /Usage:/);
  assert.match(HELP_TEXT, /--help/);
  assert.match(HELP_TEXT, /-h/);
  assert.match(HELP_TEXT, /--execute/);
  assert.match(HELP_TEXT, /--issue <number>/);
  assert.match(HELP_TEXT, /--all/);
  assert.match(HELP_TEXT, /without active triage or protection labels/);
  assert.match(HELP_TEXT, /including issues already carrying triage or protection labels such as in-progress or blocked/);
});

test("formatResultLines prints dry-run label and comment changes", () => {
  const lines = formatResultLines({
    status: "dry-run",
    issueCount: 1,
    logPath: "/tmp/triage.json",
    issues: [{
      issueNumber: 1,
      title: "Needs info",
      previousLabels: ["bug"],
      finalLabels: ["bug", "needs-info", "priority:medium"],
      primaryBucket: "needs-info",
      confidence: "medium",
      rationale: "Missing reproduction details.",
      questions: ["What exact steps reproduce the issue?"],
      comment: "Automated triage needs more information before this can be planned:\n\n1. What exact steps reproduce the issue?",
      mutationStatus: "planned",
    }],
  });

  assert.deepEqual(lines, [
    "#1 needs-info",
    "  labels: bug -> bug, needs-info, priority:medium",
    "  comment: Automated triage needs more information before this can be planned:",
  ]);
});

test("runTriage execute creates missing labels before applying issue labels", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: labelsMissingNeedsInfoJson, stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: needsInfoDecisionJson, stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: false,
    execute: true,
    issueNumber: 1,
    logDir,
  });

  assert.equal(result.status, "applied");
  const commands = runner.calls.map((call) => `${call.command} ${call.args.join(" ")}`);
  const firstCreate = commands.findIndex((command) => command.includes("labels create"));
  const edit = commands.findIndex((command) => command.includes("issues edit 1"));
  assert.ok(firstCreate >= 0);
  assert.ok(edit > firstCreate);
  assert.ok(commands.some((command) => command.includes("comment 1 --repo /repo -- Automated triage needs more information")));
});

test("runTriage passes explicit tea login to Forgejo commands only", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: allLabelsJson, stderr: "" },
    { code: 0, stdout: needsInfoDecisionJson, stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
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
  assert.ok(teaCalls.every((call) => call.args.includes("--login") && call.args.includes("triage-agent")));
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

      if (command === "tea" && args.includes("issues") && args.includes("list")) {
        const page = args[args.indexOf("--page") + 1];
        return { code: 0, stdout: page === "1" ? issueJson : JSON.stringify([]), stderr: "" };
      }

      if (command === "tea" && args.includes("--comments")) {
        return noCommentsOutput;
      }

      if (command === "tea" && args.includes("labels") && args.includes("list")) {
        return { code: 0, stdout: allLabelsJson, stderr: "" };
      }

      if (command === "pi") {
        assert.equal(args.includes("--skill"), false);
        const promptPath = args[args.indexOf("-p") + 1]?.slice(1);
        assert.ok(promptPath);
        const prompt = await readFile(promptPath, "utf8");
        assert.match(prompt, /Use the configured triage skill: `project-triage`\./);
        return { code: 0, stdout: needsInfoDecisionJson, stderr: "" };
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

test("runTriage applies limit after listing open issues", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const twoIssues = JSON.stringify([
    { index: 1, title: "One", body: "", state: "open", labels: [] },
    { index: 2, title: "Two", body: "", state: "open", labels: [] },
  ]);
  const oneDecision = JSON.stringify({ decisions: [{
    issueNumber: 1,
    primaryBucket: "agent-unsuitable",
    labels: ["agent-unsuitable"],
    confidence: "high",
    rationale: "Not actionable for automation.",
    questions: [],
    comment: null,
  }] });
  const runner = createStaticCommandRunner([
    { code: 0, stdout: twoIssues, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: allLabelsJson, stderr: "" },
    { code: 0, stdout: oneDecision, stderr: "" },
  ]);

  const result = await runTriage(runner, { repoRoot: "/repo", dryRun: true, execute: false, limit: 1, logDir });

  assert.equal(result.issueCount, 1);
});

test("runTriage skips already triaged open issues by default before applying limit", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const mixedIssues = JSON.stringify([
    { index: 1, title: "Already ready", body: "Clear", state: "open", labels: [{ name: "agent-ready" }] },
    { index: 2, title: "Already blocked", body: "Needs decision", state: "open", labels: [{ name: "needs-info" }] },
    { index: 3, title: "Untriaged", body: "Broken", state: "open", labels: [{ name: "bug" }] },
  ]);
  const decision = JSON.stringify({ decisions: [{
    issueNumber: 3,
    primaryBucket: "agent-ready",
    labels: ["bug", "agent-ready", "priority:medium"],
    confidence: "high",
    rationale: "Clear issue ready for the planning workflow.",
    questions: [],
    comment: null,
  }] });
  const runner = createStaticCommandRunner([
    { code: 0, stdout: mixedIssues, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: allLabelsJson, stderr: "" },
    { code: 0, stdout: decision, stderr: "" },
  ]);

  const result = await runTriage(runner, { repoRoot: "/repo", dryRun: true, execute: false, limit: 1, logDir });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 3);
});

test("runTriage skips in-progress issues by default before applying limit", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const mixedIssues = JSON.stringify([
    { index: 1, title: "Claimed", body: "Already being worked", state: "open", labels: [{ name: "in-progress" }] },
    { index: 2, title: "Untriaged", body: "Broken", state: "open", labels: [{ name: "bug" }] },
  ]);
  const decision = JSON.stringify({ decisions: [{
    issueNumber: 2,
    primaryBucket: "agent-ready",
    labels: ["bug", "agent-ready", "priority:medium"],
    confidence: "high",
    rationale: "Clear issue ready for the planning workflow.",
    questions: [],
    comment: null,
  }] });
  const runner = createStaticCommandRunner([
    { code: 0, stdout: mixedIssues, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: allLabelsJson, stderr: "" },
    { code: 0, stdout: decision, stderr: "" },
  ]);

  const result = await runTriage(runner, { repoRoot: "/repo", dryRun: true, execute: false, limit: 1, logDir });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 2);
});

test("runTriage skips blocked issues by default before applying limit", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const mixedIssues = JSON.stringify([
    { index: 1, title: "Blocked", body: "Waiting on dependency", state: "open", labels: [{ name: "blocked" }] },
    { index: 2, title: "Untriaged", body: "Broken", state: "open", labels: [{ name: "bug" }] },
  ]);
  const decision = JSON.stringify({ decisions: [{
    issueNumber: 2,
    primaryBucket: "agent-ready",
    labels: ["bug", "agent-ready", "priority:medium"],
    confidence: "high",
    rationale: "Clear issue ready for the planning workflow.",
    questions: [],
    comment: null,
  }] });
  const runner = createStaticCommandRunner([
    { code: 0, stdout: mixedIssues, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: allLabelsJson, stderr: "" },
    { code: 0, stdout: decision, stderr: "" },
  ]);

  const result = await runTriage(runner, { repoRoot: "/repo", dryRun: true, execute: false, limit: 1, logDir });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 2);
});

test("runTriage --all includes in-progress issues for recovery", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const triagedIssue = JSON.stringify([
    { index: 1, title: "Claimed", body: "Already being worked", state: "open", labels: [{ name: "in-progress" }] },
  ]);
  const decision = JSON.stringify({ decisions: [{
    issueNumber: 1,
    primaryBucket: "agent-ready",
    labels: ["agent-ready", "priority:medium"],
    confidence: "high",
    rationale: "Clear issue ready for the planning workflow.",
    questions: [],
    comment: null,
  }] });
  const runner = createStaticCommandRunner([
    { code: 0, stdout: triagedIssue, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: allLabelsJson, stderr: "" },
    { code: 0, stdout: decision, stderr: "" },
  ]);

  const result = await runTriage(runner, { repoRoot: "/repo", dryRun: true, execute: false, all: true, logDir });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 1);
});

test("runTriage targeted issue overrides the in-progress default skip", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const triagedIssue = JSON.stringify([
    { index: 1, title: "Claimed", body: "Already being worked", state: "open", labels: [{ name: "in-progress" }] },
  ]);
  const decision = JSON.stringify({ decisions: [{
    issueNumber: 1,
    primaryBucket: "agent-ready",
    labels: ["agent-ready", "priority:medium"],
    confidence: "high",
    rationale: "Clear issue ready for the planning workflow.",
    questions: [],
    comment: null,
  }] });
  const runner = createStaticCommandRunner([
    { code: 0, stdout: triagedIssue, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: allLabelsJson, stderr: "" },
    { code: 0, stdout: decision, stderr: "" },
  ]);

  const result = await runTriage(runner, { repoRoot: "/repo", dryRun: true, execute: false, issueNumber: 1, logDir });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 1);
});

test("runTriage writes a failed execute log before rethrowing mutation errors", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: allLabelsJson, stderr: "" },
    { code: 0, stdout: needsInfoDecisionJson, stderr: "" },
    { code: 1, stdout: "", stderr: "labels exploded" },
  ]);

  await assert.rejects(() => runTriage(runner, {
    repoRoot: "/repo",
    dryRun: false,
    execute: true,
    logDir,
  }));

  const files = await readdir(logDir);
  assert.equal(files.length, 1);
  const log = JSON.parse(await readFile(join(logDir, files[0]!), "utf8"));
  assert.equal(log.mode, "execute");
  assert.equal(log.issues[0].issueNumber, 1);
  assert.equal(log.issues[0].mutationStatus, "failed");
  assert.match(log.issues[0].error, /labels exploded/);
  assert.match(log.error, /Failed to apply labels for issue #1/);
});

test("runTriage writes a failure log when validation fails", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: allLabelsJson, stderr: "" },
    { code: 0, stdout: JSON.stringify({ decisions: [] }), stderr: "" },
  ]);

  await assert.rejects(() => runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    logDir,
  }), /Expected 1 decisions but received 0/);

  const files = await readdir(logDir);
  assert.equal(files.length, 1);
  const log = JSON.parse(await readFile(join(logDir, files[0]!), "utf8"));
  assert.equal(log.mode, "dry-run");
  assert.equal(log.issues.length, 0);
  assert.match(log.error, /Expected 1 decisions but received 0/);
});

test("runTriage writes a failure log when missing label creation fails", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: labelsMissingNeedsInfoJson, stderr: "" },
    { code: 1, stdout: "", stderr: "cannot create label" },
  ]);

  await assert.rejects(() => runTriage(runner, {
    repoRoot: "/repo",
    dryRun: false,
    execute: true,
    logDir,
  }), /cannot create label/);

  const files = await readdir(logDir);
  assert.equal(files.length, 1);
  const log = JSON.parse(await readFile(join(logDir, files[0]!), "utf8"));
  assert.equal(log.mode, "execute");
  assert.equal(log.issues.length, 0);
  assert.match(log.error, /cannot create label/);
});

test("runTriage rejects targeted issues that are not open or not found and logs the error", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
  ]);

  await assert.rejects(() => runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    issueNumber: 123,
    logDir,
  }), /Issue #123 is not open or was not found/);

  const files = await readdir(logDir);
  assert.equal(files.length, 1);
  const log = JSON.parse(await readFile(join(logDir, files[0]!), "utf8"));
  assert.equal(log.mode, "dry-run");
  assert.equal(log.issues.length, 0);
  assert.match(log.error, /Issue #123 is not open or was not found/);
});
