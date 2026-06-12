import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import { createStaticCommandRunner } from "../../../../test-support/command-runner.ts";
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
    host: DEFAULT_PATCHMILL_CONFIG.host,
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

test("runTriage dry-run enables Pi session observation for tool-call logging", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: needsInfoPreviewJson, stderr: "" },
  ]);

  await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    logDir,
    host: DEFAULT_PATCHMILL_CONFIG.host,
    onToolCall() {},
  });

  const piCall = runner.calls.find((call) => call.command === "pi");
  assert.ok(piCall);
  assert.notEqual(piCall.args.indexOf("--session-dir"), -1);
  assert.equal(piCall.args.includes("--no-session"), false);
});

test("runTriage dry-run emits selected and issue progress events", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const events: string[] = [];
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
    host: DEFAULT_PATCHMILL_CONFIG.host,
    onProgress: (event) => {
      if (event.type === "selected") events.push(`selected:${event.total}`);
      if (event.type === "issue") {
        events.push(
          `issue:${event.completed}/${event.total}:#${event.issue.issueNumber}`,
        );
      }
    },
  });

  assert.equal(result.status, "dry-run");
  assert.deepEqual(events, ["selected:1", "issue:1/1:#1"]);
});

test("runTriage uses github-gh host provider from config host", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: JSON.stringify([
        {
          number: 1,
          title: "Needs info",
          body: "Broken",
          state: "OPEN",
          labels: [{ name: "bug" }],
          author: { login: "alice" },
          updatedAt: "2026-05-28T10:00:00Z",
        },
      ]),
      stderr: "",
    },
    {
      code: 0,
      stdout: JSON.stringify({
        number: 1,
        title: "Needs info",
        body: "Broken",
        state: "OPEN",
        labels: [{ name: "bug" }],
        author: { login: "alice" },
        updatedAt: "2026-05-28T10:00:00Z",
        comments: [],
      }),
      stderr: "",
    },
    { code: 0, stdout: needsInfoPreviewJson, stderr: "" },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    logDir,
    host: { provider: "github-gh", login: "" },
  });

  assert.equal(result.status, "dry-run");
  assert.deepEqual(
    runner.calls
      .filter((call) => call.command === "gh")
      .map((call) => [call.command, ...call.args].join(" ")),
    [
      "gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,updatedAt,url",
      "gh issue view 1 --json number,title,body,state,labels,author,updatedAt,url,comments",
    ],
  );
  assert.equal(
    runner.calls.some((call) => call.command === "pi"),
    true,
  );
  assert.equal(
    runner.calls.some((call) => call.command === "tea"),
    false,
  );
});

test("runTriage targeted GitHub issue reads issue by number", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = {
    calls: [] as Array<{ command: string; args: string[]; cwd?: string }>,
    async run(command: string, args: string[], options = {}) {
      runner.calls.push({ command, args: [...args], cwd: options.cwd });

      if (command === "gh" && args[0] === "issue" && args[1] === "view") {
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 1001,
            title: "Outside the list cap",
            body: "Needs triage",
            state: "OPEN",
            labels: [{ name: "bug" }],
            author: { login: "alice" },
            updatedAt: "2026-05-28T10:00:00Z",
            comments: [],
          }),
          stderr: "",
        };
      }

      if (command === "pi") {
        return { code: 0, stdout: agentReadyPreviewJson(1001), stderr: "" };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  };

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    issueNumber: 1001,
    logDir,
    host: { provider: "github-gh", login: "" },
  });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issues[0]?.issueNumber, 1001);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "gh" && call.args.join(" ").startsWith("issue list"),
    ),
    false,
  );
  assert.ok(
    runner.calls.some(
      (call) =>
        call.command === "gh" &&
        call.args.slice(0, 3).join(" ") === "issue view 1001",
    ),
  );
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
    noCommentsOutput,
    { code: 0, stdout: "triaged", stderr: "" },
    { code: 0, stdout: afterIssueJson, stderr: "" },
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
    host: DEFAULT_PATCHMILL_CONFIG.host,
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

test("runTriage execute emits each issue after its own snapshot", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const events: string[] = [];
  const runner = {
    calls: [] as Array<{ command: string; args: string[]; cwd?: string }>,
    async run(command: string, args: string[], options = {}) {
      runner.calls.push({ command, args: [...args], cwd: options.cwd });

      if (command === "gh" && args.slice(0, 2).join(" ") === "issue list") {
        return {
          code: 0,
          stdout: JSON.stringify([
            {
              number: 1,
              title: "One",
              body: "Broken one",
              state: "OPEN",
              labels: [{ name: "bug" }],
              url: "https://example.test/issues/1",
            },
            {
              number: 2,
              title: "Two",
              body: "Broken two",
              state: "OPEN",
              labels: [{ name: "bug" }],
              url: "https://example.test/issues/2",
            },
          ]),
          stderr: "",
        };
      }

      if (command === "gh" && args.slice(0, 3).join(" ") === "issue view 1") {
        const piCalls = runner.calls.filter(
          (call) => call.command === "pi",
        ).length;
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 1,
            title: "One",
            body: "Broken one",
            state: "OPEN",
            labels: [{ name: piCalls > 0 ? "agent-ready" : "bug" }],
            url: "https://example.test/issues/1",
            comments: [],
          }),
          stderr: "",
        };
      }

      if (command === "gh" && args.slice(0, 3).join(" ") === "issue view 2") {
        const piCalls = runner.calls.filter(
          (call) => call.command === "pi",
        ).length;
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 2,
            title: "Two",
            body: "Broken two",
            state: "OPEN",
            labels: [{ name: piCalls > 1 ? "agent-ready" : "bug" }],
            url: "https://example.test/issues/2",
            comments: [],
          }),
          stderr: "",
        };
      }

      if (command === "pi") {
        return { code: 0, stdout: "triaged", stderr: "" };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  };

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: false,
    execute: true,
    logDir,
    host: { provider: "github-gh", login: "" },
    onProgress: (event) => {
      if (event.type === "selected") events.push(`selected:${event.total}`);
      if (event.type === "issue") {
        const piCalls = runner.calls.filter(
          (call) => call.command === "pi",
        ).length;
        events.push(
          `issue:${event.completed}/${event.total}:#${event.issue.issueNumber}:pi=${piCalls}`,
        );
      }
    },
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(events, [
    "selected:2",
    "issue:1/2:#1:pi=1",
    "issue:2/2:#2:pi=2",
  ]);
});

test("runTriage execute snapshots Forgejo issues without repeated all-issue scans", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const events: string[] = [];
  const runner = {
    calls: [] as Array<{ command: string; args: string[]; cwd?: string }>,
    async run(command: string, args: string[], options = {}) {
      runner.calls.push({ command, args: [...args], cwd: options.cwd });

      if (command === "tea" && args.slice(0, 2).join(" ") === "issues list") {
        const state = args[args.indexOf("--state") + 1];
        const page = args[args.indexOf("--page") + 1];
        const piCalls = runner.calls.filter(
          (call) => call.command === "pi",
        ).length;
        if (state === "open" && page === "1") {
          return {
            code: 0,
            stdout: JSON.stringify([
              {
                index: 1,
                title: "One",
                body: "Broken one",
                state: "open",
                labels: [{ name: "bug" }],
              },
              {
                index: 2,
                title: "Two",
                body: "Broken two",
                state: "open",
                labels: [{ name: "bug" }],
              },
            ]),
            stderr: "",
          };
        }
        if (state === "all" && page === "1") {
          return {
            code: 0,
            stdout: JSON.stringify([
              {
                index: 1,
                title: "One",
                body: "Broken one",
                state: "open",
                labels: [{ name: piCalls > 0 ? "agent-ready" : "bug" }],
              },
              {
                index: 2,
                title: "Two",
                body: "Broken two",
                state: "open",
                labels: [{ name: piCalls > 1 ? "agent-ready" : "bug" }],
              },
            ]),
            stderr: "",
          };
        }
        return { code: 0, stdout: JSON.stringify([]), stderr: "" };
      }

      if (command === "tea" && args[0] === "issues" && args[2] === "--fields") {
        const piCalls = runner.calls.filter(
          (call) => call.command === "pi",
        ).length;
        const issueNumber = Number(args[1]);
        return {
          code: 0,
          stdout: JSON.stringify({
            index: issueNumber,
            title: issueNumber === 1 ? "One" : "Two",
            body: issueNumber === 1 ? "Broken one" : "Broken two",
            state: "open",
            labels: [
              {
                name: piCalls >= issueNumber ? "agent-ready" : "bug",
              },
            ],
          }),
          stderr: "",
        };
      }

      if (
        command === "tea" &&
        args[0] === "issues" &&
        args.includes("--comments")
      ) {
        return noCommentsOutput;
      }

      if (command === "pi") {
        return { code: 0, stdout: "triaged", stderr: "" };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  };

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: false,
    execute: true,
    logDir,
    host: DEFAULT_PATCHMILL_CONFIG.host,
    onProgress: (event) => {
      if (event.type === "issue") {
        events.push(
          `#${event.issue.issueNumber}:${event.issue.finalLabels.join(",")}`,
        );
      }
    },
  });

  const allIssueScanCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args.slice(0, 2).join(" ") === "issues list" &&
      call.args[call.args.indexOf("--state") + 1] === "all",
  );
  const unfilteredAllIssueScanCalls = allIssueScanCalls.filter(
    (call) => !call.args.includes("--keyword"),
  );
  const keywordSnapshotCalls = allIssueScanCalls.filter(
    (call) =>
      call.args.includes("--keyword") &&
      ["1", "2"].includes(call.args[call.args.indexOf("--keyword") + 1] ?? ""),
  );

  assert.equal(result.status, "applied");
  assert.deepEqual(events, ["#1:agent-ready", "#2:agent-ready"]);
  assert.equal(unfilteredAllIssueScanCalls.length, 0);
  assert.equal(keywordSnapshotCalls.length, 2);
});

test("runTriage passes explicit tea login to Forgejo commands only", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const beforeIssueJson = JSON.stringify([
    {
      index: 1,
      title: "Needs info",
      body: "Broken",
      state: "open",
      labels: [{ name: "bug" }],
    },
  ]);
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
    { code: 0, stdout: beforeIssueJson, stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: "triaged", stderr: "" },
    { code: 0, stdout: afterIssueJson, stderr: "" },
    noCommentsOutput,
  ]);

  await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: false,
    execute: true,
    issueNumber: 1,
    logDir,
    host: { ...DEFAULT_PATCHMILL_CONFIG.host, login: "triage-agent" },
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
    host: DEFAULT_PATCHMILL_CONFIG.host,
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
        args[0] === "issues" &&
        args[1] === "list" &&
        args.includes("--keyword") &&
        args[args.indexOf("--keyword") + 1] === "1" &&
        args.includes("--fields")
      ) {
        const piCalls = runner.calls.filter(
          (call) => call.command === "pi",
        ).length;
        return {
          code: 0,
          stdout: piCalls > 0 ? afterIssueJson : beforeIssueJson,
          stderr: "",
        };
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
        assert.match(
          prompt,
          /configured issue host is Forgejo\/Gitea through `tea`/i,
        );
        assert.match(
          prompt,
          /use `tea` for issue labels, comments, and status operations/i,
        );
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
    host: DEFAULT_PATCHMILL_CONFIG.host,
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
      host: DEFAULT_PATCHMILL_CONFIG.host,
    }),
  );

  const files = await readdir(logDir);
  assert.equal(files.length, 1);
  const log = JSON.parse(await readFile(join(logDir, files[0]!), "utf8"));
  assert.equal(log.mode, "execute");
  assert.equal(log.issues.length, 0);
  assert.match(log.error, /triage exploded/);
});

test("runTriage execute failure log keeps completed issue entries", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  let piCalls = 0;
  const runner = {
    async run(command: string, args: string[]) {
      if (command === "gh" && args.slice(0, 2).join(" ") === "issue list") {
        return {
          code: 0,
          stdout: JSON.stringify([
            { number: 1, title: "One", body: "", state: "OPEN", labels: [] },
            { number: 2, title: "Two", body: "", state: "OPEN", labels: [] },
          ]),
          stderr: "",
        };
      }

      if (command === "gh" && args.slice(0, 3).join(" ") === "issue view 1") {
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 1,
            title: "One",
            body: "",
            state: "OPEN",
            labels: [{ name: piCalls > 0 ? "agent-ready" : "bug" }],
            comments: [],
          }),
          stderr: "",
        };
      }

      if (command === "gh" && args.slice(0, 3).join(" ") === "issue view 2") {
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 2,
            title: "Two",
            body: "",
            state: "OPEN",
            labels: [],
            comments: [],
          }),
          stderr: "",
        };
      }

      if (command === "pi") {
        piCalls += 1;
        return piCalls === 1
          ? { code: 0, stdout: "triaged", stderr: "" }
          : { code: 1, stdout: "", stderr: "second issue exploded" };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  };

  await assert.rejects(
    () =>
      runTriage(runner, {
        repoRoot: "/repo",
        dryRun: false,
        execute: true,
        logDir,
        host: { provider: "github-gh", login: "" },
      }),
    /second issue exploded/,
  );

  const files = await readdir(logDir);
  const log = JSON.parse(await readFile(join(logDir, files[0]!), "utf8"));
  assert.equal(log.mode, "execute");
  assert.equal(log.issues.length, 1);
  assert.equal(log.issues[0].issueNumber, 1);
  assert.match(log.error, /second issue exploded/);
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
        host: DEFAULT_PATCHMILL_CONFIG.host,
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
        host: DEFAULT_PATCHMILL_CONFIG.host,
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

test("runTriage rejects targeted issues that are not open and logs the error", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: JSON.stringify([
        {
          index: 123,
          title: "Closed",
          body: "Already closed",
          state: "closed",
          labels: [],
        },
      ]),
      stderr: "",
    },
    noCommentsOutput,
  ]);

  await assert.rejects(
    () =>
      runTriage(runner, {
        repoRoot: "/repo",
        dryRun: true,
        execute: false,
        issueNumber: 123,
        logDir,
        host: DEFAULT_PATCHMILL_CONFIG.host,
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
