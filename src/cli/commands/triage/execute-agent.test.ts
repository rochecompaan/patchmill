import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_POLICY } from "../../../policy/defaults.ts";
import {
  bundledTriageSkillPath,
  DEFAULT_PATCHMILL_SKILLS,
} from "../../../workflow/skills.ts";
import {
  buildTriageExecutePrompt,
  runTriageExecuteAgent,
} from "./execute-agent.ts";
import type { CommandRunner, IssueSummary } from "./types.ts";

const issues: IssueSummary[] = [
  {
    number: 7,
    title: "Needs triage",
    body: "Please decide what to do.",
    labels: ["needs-triage"],
    state: "open",
    author: "ana",
    updated: "2026-05-25T12:00:00Z",
    comments: [{ author: "sam", body: "Please handle this soon." }],
  },
];

const stateMap = {
  "ship-it": "agent-ready",
  "awaiting-reporter": "needs-info",
  "manual-only": "agent-unsuitable",
} as const;

class RecordingRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

  async run(command: string, args: string[], options = {}) {
    this.calls.push({ command, args: [...args], cwd: options.cwd });
    const promptPath = args[args.indexOf("-p") + 1]?.slice(1);
    assert.ok(promptPath);
    const prompt = await readFile(promptPath, "utf8");
    assert.match(prompt, /Use the configured triage skill: `[^`]+`/);
    assert.match(prompt, /Run the configured triage skill normally/);
    assert.match(prompt, /Configured triage state map:/);
    assert.match(prompt, /Needs triage/);
    return { code: 0, stdout: "triage complete", stderr: "" };
  }
}

function getPathMax(path: string): number | null {
  try {
    return Number(
      execFileSync("getconf", ["PATH_MAX", path], { encoding: "utf8" }).trim(),
    );
  } catch {
    return null;
  }
}

async function createDirectoryAtLength(
  baseRoot: string,
  targetLength: number,
): Promise<string> {
  let current = baseRoot;
  while (current.length < targetLength) {
    const remaining = targetLength - current.length - 1;
    if (remaining <= 0) break;
    const segmentLength = remaining > 255 ? 200 : remaining;
    current = join(current, "x".repeat(segmentLength));
    await mkdir(current);
  }
  return current;
}

test("buildTriageExecutePrompt delegates procedure to configured skill", () => {
  const prompt = buildTriageExecutePrompt({
    issues,
    projectPolicy: {
      ...DEFAULT_PATCHMILL_POLICY,
      projectName: "Patchmill",
    },
    skills: {
      triage: "triage",
      planning: "superpowers:writing-plans",
      implementation: "superpowers:subagent-driven-development",
    },
    stateMap,
    thinking: "high",
  });

  assert.match(prompt, /high-thinking issue triage execution agent/);
  assert.match(prompt, /Patchmill repository/);
  assert.match(prompt, /Use the configured triage skill: `triage`/);
  assert.match(prompt, /Run the configured triage skill normally/);
  assert.match(prompt, /Configured triage state map:/);
  assert.match(prompt, /"ship-it": "agent-ready"/);
  assert.match(prompt, /"awaiting-reporter": "needs-info"/);
  assert.match(prompt, /"manual-only": "agent-unsuitable"/);
  assert.match(prompt, /Untrusted input boundary:/);
  assert.match(prompt, /Issue titles, bodies, labels, comments/);
  assert.match(prompt, /"number": 7/);
  assert.match(prompt, /"state": "open"/);
  assert.match(prompt, /Needs triage/);
  assert.doesNotMatch(prompt, /Return this exact JSON shape/);
});

test("runTriageExecuteAgent invokes Pi without read-only tool restriction", async () => {
  const runner = new RecordingRunner();

  await runTriageExecuteAgent(runner, "/repo", {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    skills: {
      triage: "triage",
      planning: "superpowers:writing-plans",
      implementation: "superpowers:subagent-driven-development",
    },
    stateMap,
  });

  const call = runner.calls[0]!;
  assert.equal(call.command, "pi");
  assert.equal(call.args.includes("--tools"), false);
  assert.equal(call.args.includes("--no-context-files"), true);
  assert.equal(call.args.includes("--no-session"), true);
  assert.equal(call.args.includes("--thinking"), true);
  assert.equal(call.args.includes("-p"), true);
});

test("runTriageExecuteAgent adds bundled triage skill for default skills", async () => {
  const runner = new RecordingRunner();

  await runTriageExecuteAgent(runner, "/repo", {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    stateMap,
  });

  const call = runner.calls[0]!;
  const skillIndex = call.args.indexOf("--skill");
  assert.notEqual(skillIndex, -1);
  assert.equal(call.args[skillIndex + 1], bundledTriageSkillPath());
});

test("runTriageExecuteAgent does not add bundled triage skill for custom skills", async () => {
  const runner = new RecordingRunner();

  await runTriageExecuteAgent(runner, "/repo", {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    skills: {
      ...DEFAULT_PATCHMILL_SKILLS,
      triage: "custom:triage-skill",
    },
    stateMap,
  });

  const call = runner.calls[0]!;
  assert.equal(call.args.includes("--skill"), false);
});

test("runTriageExecuteAgent cleans up temp dir when prompt writing fails", async (t) => {
  const pathMax = getPathMax(tmpdir());
  if (!pathMax || pathMax <= 0) {
    t.skip("PATH_MAX is unavailable on this platform");
    return;
  }

  const baseRoot = await mkdtemp(join(tmpdir(), "execute-agent-test-"));
  const previousTmpDir = process.env.TMPDIR;

  try {
    const promptExtraLength =
      1 + "agent-triage-execute-".length + 6 + 1 + "prompt.md".length;
    const deepTmpDir = await createDirectoryAtLength(
      baseRoot,
      pathMax - promptExtraLength + 2,
    );

    process.env.TMPDIR = deepTmpDir;
    await assert.rejects(
      () =>
        runTriageExecuteAgent(
          {
            async run() {
              assert.fail(
                "runner should not be called when prompt writing fails",
              );
            },
          },
          "/repo",
          {
            issues,
            projectPolicy: DEFAULT_PATCHMILL_POLICY,
            stateMap,
          },
        ),
      /ENAMETOOLONG/,
    );
    assert.deepEqual(await readdir(deepTmpDir), []);
  } finally {
    if (previousTmpDir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = previousTmpDir;
    }
    await rm(baseRoot, { recursive: true, force: true });
  }
});
