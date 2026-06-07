import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import {
  commandText,
  HELP_TEXT,
  isHelpOnlyInvocation,
  loadCliConfig,
  main,
  type TriageCliDependencies,
} from "./main.ts";
import type { CommandRunner, TriageConfig, TriageResult } from "./types.ts";

function triageConfig(overrides: Partial<TriageConfig> = {}): TriageConfig {
  return {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    triageThinking: "high",
    host: DEFAULT_PATCHMILL_CONFIG.host,
    logDir: "/repo/.patchmill/triage-runs",
    projectPolicy: DEFAULT_PATCHMILL_CONFIG.projectPolicy,
    skills: DEFAULT_PATCHMILL_CONFIG.skills,
    ...overrides,
  };
}

const commandRunner: CommandRunner = {
  async run() {
    throw new Error("command runner should not be called by these tests");
  },
};

function triageResult(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    status: "dry-run",
    issueCount: 0,
    logPath: "/repo/.patchmill/triage-runs/triage.json",
    issues: [],
    ...overrides,
  };
}

test("isHelpOnlyInvocation detects help flags", () => {
  assert.equal(isHelpOnlyInvocation(["--help"]), true);
  assert.equal(isHelpOnlyInvocation(["-h"]), true);
  assert.equal(isHelpOnlyInvocation(["--dry-run", "--help"]), true);
  assert.equal(isHelpOnlyInvocation(["--dry-run"]), false);
});

test("commandText formats the displayed triage command", () => {
  assert.equal(commandText([]), "patchmill triage");
  assert.equal(
    commandText(["--dry-run", "--limit", "2"]),
    "patchmill triage --dry-run --limit 2",
  );
});

test("loadCliConfig parses help without reading project config", async () => {
  const config = await loadCliConfig(
    ["--help"],
    "/path/that/does/not/exist",
    {},
  );

  assert.equal(config.showHelp, true);
  assert.equal(config.repoRoot, "/path/that/does/not/exist");
});

test("loadCliConfig loads defaults and applies CLI/env overrides", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "triage-main-"));
  const config = await loadCliConfig(
    ["--dry-run", "--issue", "7", "--log-dir", "triage-logs"],
    repoRoot,
    { PATCHMILL_HOST_LOGIN: "triage-agent" },
  );

  assert.equal(config.dryRun, true);
  assert.equal(config.execute, false);
  assert.equal(config.issueNumber, 7);
  assert.equal(config.logDir, "triage-logs");
  assert.equal(config.host.login, "triage-agent");
});

test("main prints help and skips triage", async () => {
  const stdout: string[] = [];
  let ranTriage = false;
  const deps: TriageCliDependencies = {
    async loadCliConfig() {
      return triageConfig({ showHelp: true });
    },
    createCommandRunner() {
      return commandRunner;
    },
    async runTriage() {
      ranTriage = true;
      return triageResult();
    },
    createProgressReporter() {
      throw new Error("reporter should not be created for help");
    },
    writeStdout(line) {
      stdout.push(line);
    },
    writeStderr() {
      throw new Error("stderr should not be written");
    },
  };

  const code = await main(["--help"], deps);

  assert.equal(code, 0);
  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.equal(ranTriage, false);
});

test("main runs triage with the command runner and progress reporter", async () => {
  const events: string[] = [];
  const onProgress = () => events.push("progress");
  const onToolCall = () => events.push("tool");
  const result = triageResult({ status: "applied" });
  const config = triageConfig({ dryRun: false, execute: true });
  let finishedWith: TriageResult | undefined;
  const deps: TriageCliDependencies = {
    async loadCliConfig(args) {
      assert.deepEqual(args, ["--issue", "12"]);
      return config;
    },
    createCommandRunner() {
      return commandRunner;
    },
    async runTriage(runner, runConfig) {
      assert.strictEqual(runner, commandRunner);
      assert.strictEqual(runConfig.onProgress, onProgress);
      assert.strictEqual(runConfig.onToolCall, onToolCall);
      assert.equal(runConfig.issueNumber, undefined);
      return result;
    },
    createProgressReporter(options) {
      assert.equal(options.command, "patchmill triage --issue 12");
      return {
        onProgress,
        onToolCall,
        finish(finishedResult) {
          finishedWith = finishedResult;
        },
      };
    },
    writeStdout() {
      throw new Error("stdout should be owned by reporter");
    },
    writeStderr() {
      throw new Error("stderr should not be written");
    },
  };

  const code = await main(["--issue", "12"], deps);

  assert.equal(code, 0);
  assert.strictEqual(finishedWith, result);
});

test("main wires tool-call output to the live console by default", async () => {
  const stdout: string[] = [];
  const result = triageResult({ status: "applied" });
  const config = triageConfig({ dryRun: false, execute: true });
  const deps: TriageCliDependencies = {
    async loadCliConfig(args) {
      assert.deepEqual(args, []);
      return config;
    },
    createCommandRunner() {
      return commandRunner;
    },
    async runTriage(_runner, runConfig) {
      runConfig.onToolCall?.({ toolName: "bash" });
      return result;
    },
    createProgressReporter(options) {
      assert.equal(options.command, "patchmill triage");
      return {
        onProgress() {},
        onToolCall(event) {
          stdout.push(`tool:${event.toolName ?? "tool"}`);
        },
        finish() {},
      };
    },
    writeStdout() {
      throw new Error("stdout should be owned by reporter");
    },
    writeStderr() {
      throw new Error("stderr should not be written");
    },
  };

  const code = await main([], deps);

  assert.equal(code, 0);
  assert.deepEqual(stdout, ["tool:bash"]);
});

test("main writes errors and returns one", async () => {
  const stderr: string[] = [];
  const deps: TriageCliDependencies = {
    async loadCliConfig() {
      throw new Error("bad argument");
    },
    createCommandRunner() {
      return commandRunner;
    },
    async runTriage() {
      throw new Error("triage should not run");
    },
    createProgressReporter() {
      throw new Error("reporter should not be created");
    },
    writeStdout() {
      throw new Error("stdout should not be written");
    },
    writeStderr(line) {
      stderr.push(line);
    },
  };

  const code = await main(["--unknown"], deps);

  assert.equal(code, 1);
  assert.deepEqual(stderr, ["bad argument"]);
});
