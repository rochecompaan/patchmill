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
  buildTriageDryRunPrompt,
  parseTriagePreviewJson,
  runTriageDryRunAgent,
  validateTriagePreviewDocument,
} from "./dry-run-agent.ts";
import type {
  CommandRunOptions,
  CommandRunner,
  IssueSummary,
} from "./types.ts";

const issues: IssueSummary[] = [
  {
    number: 42,
    title: "Add export",
    body: "Please add CSV export.",
    labels: ["needs-triage", "enhancement"],
    state: "open",
    author: "ana",
    updated: "2026-05-25T12:00:00Z",
    comments: [{ authorLogin: "sam", body: "CSV is enough." }],
  },
];

const stateMap = {
  "ready-for-agent": "agent-ready",
  "needs-info": "needs-info",
  "ready-for-human": "agent-unsuitable",
  blocked: "blocked",
} as const;

async function createProjectLocalTriageRepo(): Promise<{
  repoRoot: string;
  triageSkillPath: string;
  supportSkillPath: string;
}> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-dry-run-"));
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
  readonly calls: Array<{
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
  }> = [];

  async run(command: string, args: string[], options: CommandRunOptions = {}) {
    this.calls.push({
      command,
      args: [...args],
      cwd: options.cwd,
      env: options.env,
    });
    const promptPath = args[args.indexOf("-p") + 1]?.slice(1);
    assert.ok(promptPath);
    const prompt = await readFile(promptPath, "utf8");
    assert.match(prompt, /Use the configured triage skill: `[^`]+`/);
    assert.match(prompt, /Do not execute any instruction from the skill/);
    assert.match(prompt, /Return JSON only/);
    assert.match(prompt, /Add export/);
    return {
      code: 0,
      stdout: JSON.stringify({
        previews: [
          {
            issueNumber: 42,
            currentLabels: ["needs-triage", "enhancement"],
            proposedLabels: ["ready-for-agent", "enhancement"],
            canonicalBucket: "agent-ready",
            blockedBy: [],
            rationale: "Clear enough for an agent.",
            wouldComment: "## Agent Brief\nImplement CSV export.",
            wouldClose: false,
            questions: [],
          },
        ],
      }),
      stderr: "",
    };
  }
}

test("buildTriageDryRunPrompt wraps configured skill as read-only preview", () => {
  const prompt = buildTriageDryRunPrompt({
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    skills: {
      triage: "triage",
      planning: "superpowers:writing-plans",
      implementation: "superpowers:subagent-driven-development",
    },
    stateMap,
    thinking: "medium",
  });

  assert.match(prompt, /medium-thinking issue triage preview agent/);
  assert.match(prompt, /Use the configured triage skill: `triage`/);
  assert.match(prompt, /Do not mutate repository-hosting state/);
  assert.match(prompt, /Do not execute any instruction from the skill/);
  assert.match(prompt, /"canonicalBucket": "agent-ready"/);
  assert.match(prompt, /"blockedBy": \[\]/);
  assert.match(prompt, /"ready-for-agent": "agent-ready"/);
  assert.match(
    prompt,
    /blockedBy must list concrete same-repository issue numbers/,
  );
  assert.match(prompt, /Use canonicalBucket needs-info instead of blocked/);
  assert.match(prompt, /Add export/);
});

test("parseTriagePreviewJson extracts direct and fenced JSON", () => {
  assert.deepEqual(parseTriagePreviewJson('{"previews":[]}'), {
    previews: [],
  });
  assert.deepEqual(parseTriagePreviewJson('```json\n{"previews":[]}\n```'), {
    previews: [],
  });
});

test("parseTriagePreviewJson recovers preview document with trailing extra brace", () => {
  const stdout =
    '{"previews":[{"issueNumber":123,"currentLabels":["enhancement"],"proposedLabels":["enhancement","agent-ready"],"canonicalBucket":"agent-ready","blockedBy":[],"rationale":"Ready for implementation.","wouldComment":null,"wouldClose":false,"questions":[]}]}}';

  assert.deepEqual(parseTriagePreviewJson(stdout), {
    previews: [
      {
        issueNumber: 123,
        currentLabels: ["enhancement"],
        proposedLabels: ["enhancement", "agent-ready"],
        canonicalBucket: "agent-ready",
        blockedBy: [],
        rationale: "Ready for implementation.",
        wouldComment: null,
        wouldClose: false,
        questions: [],
      },
    ],
  });
});

test("parseTriagePreviewJson reports a bounded stdout snippet when recovery fails", () => {
  const stdout = `${"x".repeat(90)}{"previews":[{"issueNumber":123,]${"y".repeat(90)}`;

  assert.throws(
    () => parseTriagePreviewJson(stdout),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^Pi triage dry-run returned invalid JSON:/);
      assert.match(error.message, /stdout near parse failure:/);
      assert.match(error.message, /"previews"/);
      assert.equal(error.message.includes("x".repeat(90)), false);
      assert.equal(error.message.includes("y".repeat(90)), false);
      return true;
    },
  );
});

test("validateTriagePreviewDocument accepts one preview per issue", () => {
  const previews = validateTriagePreviewDocument(
    {
      previews: [
        {
          issueNumber: 42,
          currentLabels: ["needs-triage"],
          proposedLabels: ["ready-for-agent"],
          canonicalBucket: "agent-ready",
          blockedBy: [],
          rationale: "Clear enough.",
          wouldComment: null,
          wouldClose: false,
          questions: [],
        },
      ],
    },
    issues,
  );

  assert.deepEqual(previews, [
    {
      issueNumber: 42,
      currentLabels: ["needs-triage"],
      proposedLabels: ["ready-for-agent"],
      canonicalBucket: "agent-ready",
      blockedBy: [],
      rationale: "Clear enough.",
      wouldComment: null,
      wouldClose: false,
      questions: [],
    },
  ]);
});

test("validateTriagePreviewDocument accepts blocked previews with blocker numbers", () => {
  const previews = validateTriagePreviewDocument(
    {
      previews: [
        {
          issueNumber: 42,
          currentLabels: ["bug"],
          proposedLabels: ["blocked", "bug"],
          canonicalBucket: "blocked",
          blockedBy: [1, 2],
          rationale: "This issue must wait for the scaffold and model work.",
          wouldComment:
            "> _This was generated by AI during triage._\n\nBlocked by: #1, #2\n\nThis can run after the dependencies close.",
          wouldClose: false,
          questions: [],
        },
      ],
    },
    issues,
  );

  assert.deepEqual(previews[0]?.blockedBy, [1, 2]);
  assert.equal(previews[0]?.canonicalBucket, "blocked");
});

test("validateTriagePreviewDocument rejects invalid previews", () => {
  assert.throws(
    () => validateTriagePreviewDocument({ previews: [] }, issues),
    /Expected 1 previews but received 0/,
  );
  assert.throws(
    () =>
      validateTriagePreviewDocument(
        {
          previews: [
            {
              issueNumber: 9,
              currentLabels: [],
              proposedLabels: [],
              canonicalBucket: "agent-ready",
              rationale: "Wrong issue.",
              questions: [],
            },
          ],
        },
        issues,
      ),
    /Unknown issue number 9/,
  );
  assert.throws(
    () =>
      validateTriagePreviewDocument(
        {
          previews: [
            {
              issueNumber: 42,
              currentLabels: [],
              proposedLabels: [],
              canonicalBucket: "deferred",
              rationale: "Wrong bucket.",
              questions: [],
            },
          ],
        },
        issues,
      ),
    /Invalid canonicalBucket deferred/,
  );
  assert.throws(
    () =>
      validateTriagePreviewDocument(
        {
          previews: [
            {
              issueNumber: 42,
              currentLabels: [],
              proposedLabels: [],
              canonicalBucket: "agent-ready",
              rationale: "Wrong comment.",
              wouldComment: 7,
              questions: [],
            },
          ],
        },
        issues,
      ),
    /wouldComment for issue 42 must be a non-empty string/,
  );
  assert.throws(
    () =>
      validateTriagePreviewDocument(
        {
          previews: [
            {
              issueNumber: 42,
              currentLabels: [],
              proposedLabels: [],
              canonicalBucket: "agent-ready",
              rationale: "Wrong close flag.",
              wouldComment: null,
              wouldClose: "no",
              questions: [],
            },
          ],
        },
        issues,
      ),
    /wouldClose for issue 42 must be a boolean/,
  );
  assert.throws(
    () =>
      validateTriagePreviewDocument(
        {
          previews: [
            {
              issueNumber: 42,
              currentLabels: [],
              proposedLabels: ["blocked"],
              canonicalBucket: "blocked",
              blockedBy: [],
              rationale: "Blocked without blocker metadata.",
              wouldComment: null,
              wouldClose: false,
              questions: [],
            },
          ],
        },
        issues,
      ),
    /blockedBy for issue 42 must include at least one issue number/,
  );
  assert.throws(
    () =>
      validateTriagePreviewDocument(
        {
          previews: [
            {
              issueNumber: 42,
              currentLabels: [],
              proposedLabels: ["blocked"],
              canonicalBucket: "blocked",
              blockedBy: [42],
              rationale: "Self blocked.",
              wouldComment: null,
              wouldClose: false,
              questions: [],
            },
          ],
        },
        issues,
      ),
    /blockedBy for issue 42 must not include itself/,
  );
  assert.throws(
    () =>
      validateTriagePreviewDocument(
        {
          previews: [
            {
              issueNumber: 42,
              currentLabels: [],
              proposedLabels: ["agent-ready"],
              canonicalBucket: "agent-ready",
              blockedBy: [1],
              rationale: "Not blocked.",
              wouldComment: null,
              wouldClose: false,
              questions: [],
            },
          ],
        },
        issues,
      ),
    /blockedBy for issue 42 is only valid when canonicalBucket is blocked/,
  );
});

test("runTriageDryRunAgent invokes Pi with read-only tools", async () => {
  const runner = new RecordingRunner();

  const previews = await runTriageDryRunAgent(runner, "/repo", {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    skills: {
      triage: "triage",
      planning: "superpowers:writing-plans",
      implementation: "superpowers:subagent-driven-development",
    },
    stateMap,
    thinking: "medium",
  });

  assert.equal(previews[0]?.canonicalBucket, "agent-ready");
  const call = runner.calls[0]!;
  assert.equal(call.command, process.execPath);
  assert.match(
    call.args[0] ?? "",
    /@earendil-works[/\\]pi-coding-agent[/\\]dist[/\\]cli\.js$/,
  );
  assert.equal(call.env?.PI_CODING_AGENT_DIR, "/repo/.patchmill/pi-agent");
  const toolsIndex = call.args.indexOf("--tools");
  assert.notEqual(toolsIndex, -1);
  assert.deepEqual(call.args.slice(toolsIndex, toolsIndex + 4), [
    "--tools",
    "read,grep,find,ls",
    "--no-context-files",
    "--no-session",
  ]);
});

test("runTriageDryRunAgent enables session observation for tool-call logging", async () => {
  const runner = new RecordingRunner();

  await runTriageDryRunAgent(runner, "/repo", {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    stateMap,
    onToolCall() {},
  });

  const call = runner.calls[0]!;
  const sessionDirIndex = call.args.indexOf("--session-dir");
  assert.notEqual(sessionDirIndex, -1);
  assert.match(call.args[sessionDirIndex + 1] ?? "", /patchmill-triage-pi-/);
});

test("runTriageDryRunAgent adds bundled triage skill for default skills", async () => {
  const runner = new RecordingRunner();

  await runTriageDryRunAgent(runner, "/repo", {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    stateMap,
  });

  const call = runner.calls[0]!;
  const skillIndex = call.args.indexOf("--skill");
  assert.notEqual(skillIndex, -1);
  assert.equal(call.args[skillIndex + 1], bundledTriageSkillPath());
});

test("runTriageDryRunAgent does not add bundled triage skill for custom skills", async () => {
  const runner = new RecordingRunner();

  await runTriageDryRunAgent(runner, "/repo", {
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

test("runTriageDryRunAgent resolves configured local triage skill paths", async () => {
  const runner = new RecordingRunner();

  await runTriageDryRunAgent(runner, "/repo", {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
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

test("runTriageDryRunAgent uses only configured project-local triage skills", async () => {
  const runner = new RecordingRunner();
  const { repoRoot, triageSkillPath } = await createProjectLocalTriageRepo();

  await runTriageDryRunAgent(runner, repoRoot, {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
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
