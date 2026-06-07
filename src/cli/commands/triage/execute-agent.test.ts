import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_POLICY } from "../../../policy/defaults.ts";
import {
  bundledTriageSkillPath,
  DEFAULT_PATCHMILL_SKILLS,
} from "../../../workflow/skills.ts";
import {
  buildSkillPackMetadata,
  hashText,
} from "../../../workflow/skill-pack.ts";
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

async function createProjectLocalTriageRepo(): Promise<{
  repoRoot: string;
  triageSkillPath: string;
  supportSkillPath: string;
}> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-execute-"));
  const skillsRoot = join(repoRoot, ".patchmill", "skills");
  const triageSkillPath = join(
    skillsRoot,
    "patchmill-issue-triage",
    "SKILL.md",
  );
  const supportSkillPath = join(skillsRoot, "triage-support", "SKILL.md");

  await mkdir(join(skillsRoot, "patchmill-issue-triage"), { recursive: true });
  await mkdir(join(skillsRoot, "triage-support"), { recursive: true });
  const triageSkill = "# triage\n";
  const supportSkill = "# support\n";
  await writeFile(triageSkillPath, triageSkill);
  await writeFile(supportSkillPath, supportSkill);
  await writeFile(
    join(skillsRoot, "patchmill-skill-pack.json"),
    JSON.stringify(
      buildSkillPackMetadata([
        {
          path: ".patchmill/skills/patchmill-issue-triage/SKILL.md",
          sha256: hashText(triageSkill),
        },
        {
          path: ".patchmill/skills/triage-support/SKILL.md",
          sha256: hashText(supportSkill),
        },
      ]),
    ),
  );

  return { repoRoot, triageSkillPath, supportSkillPath };
}

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

test("buildTriageExecutePrompt delegates procedure to configured skill", () => {
  const prompt = buildTriageExecutePrompt({
    issues,
    projectPolicy: {
      ...DEFAULT_PATCHMILL_POLICY,
      projectName: "Patchmill",
    },
    host: { provider: "forgejo-tea", login: "" },
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

test("buildTriageExecutePrompt gives GitHub gh tooling instructions", () => {
  const prompt = buildTriageExecutePrompt({
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    host: { provider: "github-gh", login: "" },
    stateMap,
  });

  assert.match(prompt, /Configured issue host tooling:/);
  assert.match(prompt, /configured issue host is GitHub/i);
  assert.match(
    prompt,
    /use `gh` CLI for issue labels, comments, and status operations/i,
  );
  assert.match(prompt, /do not use `tea`/i);
});

test("buildTriageExecutePrompt gives Forgejo tea tooling instructions with login", () => {
  const prompt = buildTriageExecutePrompt({
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    host: { provider: "forgejo-tea", login: "triage-agent" },
    stateMap,
  });

  assert.match(
    prompt,
    /configured issue host is Forgejo\/Gitea through `tea`/i,
  );
  assert.match(
    prompt,
    /use `tea` for issue labels, comments, and status operations/i,
  );
  assert.match(prompt, /use the configured `tea` login `triage-agent`/i);
});

test("runTriageExecuteAgent invokes Pi without read-only tool restriction", async () => {
  const runner = new RecordingRunner();

  await runTriageExecuteAgent(runner, "/repo", {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    host: { provider: "forgejo-tea", login: "" },
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

test("runTriageExecuteAgent enables session observation for tool-call logging", async () => {
  const runner = new RecordingRunner();

  await runTriageExecuteAgent(runner, "/repo", {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    host: { provider: "forgejo-tea", login: "" },
    stateMap,
    onToolCall() {},
  });

  const call = runner.calls[0]!;
  const sessionDirIndex = call.args.indexOf("--session-dir");
  assert.notEqual(sessionDirIndex, -1);
  assert.match(call.args[sessionDirIndex + 1] ?? "", /patchmill-triage-pi-/);
  assert.equal(call.args.includes("--no-session"), false);
});

test("runTriageExecuteAgent adds bundled triage skill for default skills", async () => {
  const runner = new RecordingRunner();

  await runTriageExecuteAgent(runner, "/repo", {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    host: { provider: "forgejo-tea", login: "" },
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
    host: { provider: "forgejo-tea", login: "" },
    skills: {
      ...DEFAULT_PATCHMILL_SKILLS,
      triage: "custom:triage-skill",
    },
    stateMap,
  });

  const call = runner.calls[0]!;
  assert.equal(call.args.includes("--skill"), false);
});

test("runTriageExecuteAgent resolves configured local triage skill paths", async () => {
  const runner = new RecordingRunner();

  await runTriageExecuteAgent(runner, "/repo", {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    host: { provider: "forgejo-tea", login: "" },
    skills: {
      ...DEFAULT_PATCHMILL_SKILLS,
      triage: ".patchmill/skills/triage-local",
    },
    stateMap,
  });

  const call = runner.calls[0]!;
  const skillIndex = call.args.indexOf("--skill");
  assert.notEqual(skillIndex, -1);
  assert.equal(
    call.args[skillIndex + 1],
    "/repo/.patchmill/skills/triage-local/SKILL.md",
  );
});

test("runTriageExecuteAgent uses only configured project-local triage skills", async () => {
  const runner = new RecordingRunner();
  const { repoRoot, triageSkillPath } = await createProjectLocalTriageRepo();

  await runTriageExecuteAgent(runner, repoRoot, {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    host: { provider: "forgejo-tea", login: "" },
    skills: {
      ...DEFAULT_PATCHMILL_SKILLS,
      triage: ".patchmill/skills/patchmill-issue-triage",
    },
    stateMap,
  });

  const call = runner.calls[0]!;
  const skillPaths = call.args.flatMap((arg, index) =>
    arg === "--skill" ? [call.args[index + 1] ?? ""] : [],
  );
  assert.deepEqual(skillPaths, [triageSkillPath]);
});
