import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_POLICY } from "../../../policy/defaults.ts";
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
    assert.match(prompt, /Use the configured triage skill: `triage`/);
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
