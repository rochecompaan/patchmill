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
  buildTriageDryRunPrompt,
  parseTriagePreviewJson,
  runTriageDryRunAgent,
  validateTriagePreviewDocument,
} from "./dry-run-agent.ts";
import type { CommandRunner, IssueSummary } from "./types.ts";

const issues: IssueSummary[] = [
  {
    number: 42,
    title: "Add export",
    body: "Please add CSV export.",
    labels: ["needs-triage", "enhancement"],
    state: "open",
    author: "ana",
    updated: "2026-05-25T12:00:00Z",
    comments: [{ author: "sam", body: "CSV is enough." }],
  },
];

const stateMap = {
  "ready-for-agent": "agent-ready",
  "needs-info": "needs-info",
  "ready-for-human": "agent-unsuitable",
} as const;

class RecordingRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

  async run(command: string, args: string[], options = {}) {
    this.calls.push({ command, args: [...args], cwd: options.cwd });
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
  assert.match(prompt, /"ready-for-agent": "agent-ready"/);
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

test("validateTriagePreviewDocument accepts one preview per issue", () => {
  const previews = validateTriagePreviewDocument(
    {
      previews: [
        {
          issueNumber: 42,
          currentLabels: ["needs-triage"],
          proposedLabels: ["ready-for-agent"],
          canonicalBucket: "agent-ready",
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
      rationale: "Clear enough.",
      wouldComment: null,
      wouldClose: false,
      questions: [],
    },
  ]);
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
  assert.equal(call.command, "pi");
  assert.deepEqual(call.args.slice(0, 4), [
    "--tools",
    "read,grep,find,ls",
    "--no-context-files",
    "--no-session",
  ]);
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

test("runTriageDryRunAgent cleans up temp dir when prompt writing fails", async (t) => {
  const pathMax = getPathMax(tmpdir());
  if (!pathMax || pathMax <= 0) {
    t.skip("PATH_MAX is unavailable on this platform");
    return;
  }

  const baseRoot = await mkdtemp(join(tmpdir(), "dry-run-agent-test-"));
  const previousTmpDir = process.env.TMPDIR;

  try {
    const promptExtraLength =
      1 + "agent-triage-dry-run-".length + 6 + 1 + "prompt.md".length;
    const deepTmpDir = await createDirectoryAtLength(
      baseRoot,
      pathMax - promptExtraLength + 2,
    );

    process.env.TMPDIR = deepTmpDir;
    await assert.rejects(
      () =>
        runTriageDryRunAgent(
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
