import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import { createStaticCommandRunner } from "../../../../test-support/command-runner.ts";
import { runTriage } from "./pipeline.ts";

const noCommentsOutput = { code: 0, stdout: "", stderr: "" };

function previewJson(previews: unknown[]): string {
  return JSON.stringify({ previews });
}

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
    host: DEFAULT_PATCHMILL_CONFIG.host,
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
    host: DEFAULT_PATCHMILL_CONFIG.host,
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
    host: DEFAULT_PATCHMILL_CONFIG.host,
  });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 2);
});

test("runTriage includes blocked issues by default so they can be re-evaluated", async () => {
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
    {
      code: 0,
      stdout:
        "## Comments\n**@triage-agent** wrote on 2026-05-25 12:00:\n> _This was generated by AI during triage._\n\nBlocked by: #99\n--------\n",
      stderr: "",
    },
    {
      code: 0,
      stdout: JSON.stringify({
        index: 99,
        title: "Prerequisite",
        body: "Still open",
        state: "open",
        labels: [],
        comments: [],
      }),
      stderr: "",
    },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    limit: 1,
    logDir,
    host: DEFAULT_PATCHMILL_CONFIG.host,
  });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 1);
  assert.equal(result.issues[0]?.primaryBucket, "blocked");
  assert.deepEqual(result.issues[0]?.blockedBy, [99]);
  assert.equal(
    runner.calls.some((call) => call.command === "pi"),
    false,
  );
});

test("runTriage keeps blocked labels excluded when state map has no blocked bucket", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const mixedIssues = JSON.stringify([
    {
      index: 1,
      title: "Blocked by legacy label",
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
    host: DEFAULT_PATCHMILL_CONFIG.host,
    triagePolicy: createTriagePolicy(DEFAULT_PATCHMILL_CONFIG.labels, {
      stateMap: {
        "agent-ready": "agent-ready",
        "needs-info": "needs-info",
        "agent-unsuitable": "agent-unsuitable",
      },
    }),
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
    host: DEFAULT_PATCHMILL_CONFIG.host,
  });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 1);
});

test("runTriage targeted issue overrides the in-progress default skip", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const triagedIssue = JSON.stringify({
    index: 1,
    title: "Claimed",
    body: "Already being worked",
    state: "open",
    labels: [{ name: "in-progress" }],
  });
  const runner = createStaticCommandRunner([
    { code: 0, stdout: triagedIssue, stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: agentReadyPreviewJson(1), stderr: "" },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    issueNumber: 1,
    logDir,
    host: DEFAULT_PATCHMILL_CONFIG.host,
  });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 1);
});
