import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the non-interactive envelope is unchanged", () => {
  for (const phase of ["planning", "implementation"] as const) {
    assert.equal(
      renderRunEnvelope({ ...input, phase }),
      readFileSync(
        new URL(`./fixtures/envelope-${phase}.txt`, import.meta.url),
        "utf8",
      ),
    );
  }
});

test("a parent spec adds a read-only fact after the Spec line and base read command", () => {
  const text = renderRunEnvelope({
    ...input,
    facts: {
      ...input.facts,
      parentSpec: { issue: 356, path: "docs/specs/p-design.md" },
    },
  });
  assert.ok(
    text.includes(
      "- Spec: expected: docs/specs/2026-10-15-issue-9-x-design.md\n- Parent spec: docs/specs/p-design.md on origin/main (from issue #356; approved and read-only; read it with `git show 'origin/main:docs/specs/p-design.md'`, because the worktree copy can be missing or old)\n- Plan:",
    ),
  );
});

test("parent read commands quote complete ref paths with spaces and apostrophes", async (t) => {
  const { createGitFixture } =
    await import("../../test-support/git-fixture.ts");
  const fs = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { runCommand } = await import("../process/command.ts");
  const fixture = await createGitFixture();
  t.after(() => fs.rm(fixture.dir, { recursive: true, force: true }));
  const path = "docs/parent's specs/2026-10-15-issue-5-p-design.md";
  await fs.mkdir(join(fixture.repoRoot, "docs/parent's specs"), {
    recursive: true,
  });
  await fs.writeFile(join(fixture.repoRoot, path), "approved design");
  for (const args of [
    ["add", "."],
    ["commit", "-m", "Parent spec"],
    ["push", "origin", "HEAD:main"],
    ["fetch", "origin"],
  ]) {
    assert.equal(
      (
        await runCommand("git", args, {
          cwd: fixture.repoRoot,
          env: fixture.env,
        })
      ).code,
      0,
    );
  }
  const envelope = renderRunEnvelope({
    ...input,
    facts: { ...input.facts, parentSpec: { issue: 5, path } },
  });
  const command = envelope.match(/read it with `([^`]+)`/)![1]!;
  const result = await runCommand("bash", ["-c", command], {
    cwd: fixture.repoRoot,
    env: fixture.env,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "approved design");
});

test("planning with a parent spec states the parent spec rules", () => {
  const facts = {
    ...input.facts,
    parentSpec: { issue: 356, path: "docs/specs/p-design.md" },
  };
  const unattended = renderRunEnvelope({ ...input, facts });
  assert.ok(
    unattended.includes(
      "The parent spec is the approved design for this issue.",
    ),
  );
  assert.ok(unattended.includes("stop and return `needs-input`"));
  const interactive = renderRunEnvelope({ ...input, facts, interactive: true });
  assert.ok(interactive.includes("ask the maintainer in this chat"));
  assert.ok(!interactive.includes("stop and return `needs-input`"));
});

test("implementation with a parent spec shows the fact and one stop rule", () => {
  const facts = {
    ...input.facts,
    parentSpec: { issue: 356, path: "docs/specs/p-design.md" },
  };
  const text = renderRunEnvelope({ ...input, facts, phase: "implementation" });
  assert.ok(text.includes("- Parent spec:"));
  assert.ok(
    text.includes(
      "If the parent spec must change, do not change it; stop and return `needs-input`.",
    ),
  );
  assert.ok(!text.includes("The parent spec is the approved design"));
  assert.equal(
    text,
    renderRunEnvelope({
      ...input,
      facts,
      phase: "implementation",
      interactive: true,
    }),
  );
});

test("interactive planning asks the maintainer and submits through the tool", () => {
  const text = renderRunEnvelope({ ...input, interactive: true });
  assert.match(text, /A maintainer is present in this chat/);
  assert.match(text, /patchmill_submit_planning_result/);
  assert.doesNotMatch(
    text,
    /final `json` block|End with the JSON block|Put questions in the summary/,
  );
});

test("interactive planning at the implementation stage commits but does not push", () => {
  const text = renderRunEnvelope({
    ...input,
    facts: { ...facts, stage: "implementation" },
    interactive: true,
  });
  assert.match(text, /do not push/);
  assert.match(text, /committed but not pushed/);
  // Unattended planning still pushes its own work.
  assert.match(
    renderRunEnvelope({
      ...input,
      facts: { ...facts, stage: "implementation" },
    }),
    /Commit and push your work before you finish\./,
  );
});

test("interactive implementation keeps the JSON result contract", () => {
  assert.equal(
    renderRunEnvelope({ ...input, phase: "implementation", interactive: true }),
    renderRunEnvelope({ ...input, phase: "implementation" }),
  );
});

test("the envelope template stays under 150 lines", () => {
  assert.ok(
    readFileSync(new URL("./run-envelope.md", import.meta.url), "utf8").split(
      "\n",
    ).length < 150,
  );
});
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../config/config.ts";
import type { Issue, IssueDependency } from "../host/types.ts";
import type { Facts } from "./facts.ts";
import {
  renderIssue,
  renderRunEnvelope,
  renderTriageEnvelope,
  UNTRUSTED_BEGIN,
  UNTRUSTED_END,
  type RunEnvelopeInput,
} from "./envelope.ts";
import { lastJsonBlock, parseAgentResult } from "./result.ts";

const issue: Issue = {
  number: 9,
  title: "X",
  body: "Issue body",
  labels: ["intake"],
  state: "open",
  url: "https://example.invalid/issues/9",
  author: "reporter",
  createdAt: "2026-10-15",
  comments: [
    { author: "maintainer", body: "First comment", createdAt: "2026-10-16" },
    { author: "visitor", body: "Second comment", createdAt: "2026-10-17" },
    { author: "maintainer", body: "Last comment", createdAt: "2026-10-18" },
  ],
};
const facts: Facts = {
  worktree: "/trees/issue-9",
  branch: "agent/issue-9-x",
  baseBranch: "main",
  remoteBranchExists: false,
  expectedSpecPath: "docs/specs/2026-10-15-issue-9-x-design.md",
  expectedPlanPath: "docs/plans/2026-10-15-issue-9-x-plan.md",
  stage: "spec",
};
const input: RunEnvelopeInput & { dependencies: IssueDependency[] } = {
  dependencies: [],
  repository: { owner: "team", repo: "project", defaultBranch: "default" },
  issue,
  facts,
  phase: "planning",
  skill: { name: "plan-work", path: "/skills/plan work/SKILL.md" },
  timeoutMinutes: 37,
  commandLimits: { defaultSeconds: 1200, maxSeconds: 1500 },
  trusted: ["maintainer"],
};
const labels = {
  ready: "custom-ready",
  inProgress: "custom-active",
  needsInfo: "custom-info",
  done: "custom-done",
  unsuitable: "custom-unsuitable",
};

function boundary(text: string): string {
  const lines = text.split("\n");
  assert.equal(lines.filter((line) => line === UNTRUSTED_BEGIN).length, 1);
  assert.equal(lines.filter((line) => line === UNTRUSTED_END).length, 1);
  const start = lines.indexOf(UNTRUSTED_BEGIN);
  const end = lines.indexOf(UNTRUSTED_END);
  assert.ok(start < end);
  return lines.slice(start + 1, end).join("\n");
}

test("run envelope substitutes context and ordered facts with expected artifact paths", () => {
  const text = renderRunEnvelope(input);
  assert.match(text, /team\/project/);
  assert.match(text, /planning/);
  assert.ok(text.includes("plan-work"));
  assert.ok(text.includes("/skills/plan work/SKILL.md"));
  const ordered = [
    "Worktree: /trees/issue-9",
    "Branch: agent/issue-9-x",
    "Base: main",
    "Spec: expected: docs/specs/2026-10-15-issue-9-x-design.md",
    "Plan: expected: docs/plans/2026-10-15-issue-9-x-plan.md",
    "Pull request: none",
    "Gate: required; publish the spec PR",
    "Time limit: 37 minutes. About 5 minutes before the end",
  ];
  let previous = -1;
  for (const fact of ordered) {
    const index = text.indexOf(fact);
    assert.ok(index > previous, `Missing or unordered fact: ${fact}`);
    previous = index;
  }
  assert.ok(!text.includes("{{"));
});

for (const state of ["open", "merged", "closed"] as const) {
  test(`run envelope renders existing artifacts and ${state} pull request`, () => {
    const text = renderRunEnvelope({
      ...input,
      phase: "implementation",
      facts: {
        ...facts,
        specPath: "custom/spec.md",
        planPath: "custom/plan.md",
        stage: "implementation",
        pullRequest: {
          number: 12,
          url: "https://example.invalid/pulls/12",
          state,
          draft: false,
          body: "Not part of the issue",
          headRepository: "fixture/repo",
          headBranch: facts.branch,
          baseBranch: "main",
        },
      },
    });
    assert.match(text, /implementation/);
    assert.match(text, /Spec: custom\/spec.md/);
    assert.match(text, /Plan: custom\/plan.md/);
    assert.ok(!text.includes("expected:"));
    assert.ok(
      text.includes(
        `Pull request: https://example.invalid/pulls/12 (${state})`,
      ),
    );
    assert.match(text, /Gate: not required/);
  });
}

test("disabled gate is distinct from approval", () => {
  assert.match(
    renderRunEnvelope({
      ...input,
      facts: { ...facts, stage: "implementation" },
    }),
    /Gate: not required/,
  );
});

test("run example is accepted by the existing two-field result parser", () => {
  assert.deepEqual(parseAgentResult(renderRunEnvelope(input)), {
    ok: true,
    result: { status: "done", summary: "Describe the result." },
  });
});

test("shared issue block includes title, body and every comment with trust metadata", () => {
  const block = renderIssue(issue, input.trusted);
  const content = boundary(block);
  assert.match(content, /# Issue #9: X/);
  assert.ok(content.includes("Issue body"));
  assert.ok(
    content.includes(
      "### Comment by maintainer (trusted, 2026-10-16)\n\nFirst comment",
    ),
  );
  assert.ok(
    content.includes(
      "### Comment by visitor (untrusted, 2026-10-17)\n\nSecond comment",
    ),
  );
  assert.ok(
    content.includes(
      "### Comment by maintainer (trusted, 2026-10-18)\n\nLast comment",
    ),
  );
  assert.ok(renderRunEnvelope(input).includes(block));
  assert.equal(
    boundary(renderTriageEnvelope({ ...input, labels })).replace(
      "Dependencies: none\n\n",
      "",
    ),
    content,
  );
});

test("empty trusted list does not grant trust and an issue without comments still renders", () => {
  assert.match(renderIssue(issue, []), /Comment by maintainer \(untrusted,/);
  const content = boundary(renderIssue({ ...issue, comments: [] }, []));
  assert.ok(content.includes("Issue body"));
  assert.ok(!content.includes("### Comment"));
});

test("issue delimiters are escaped in title, body and all comment fields", () => {
  const hostile: Issue = {
    ...issue,
    title: `Title ${UNTRUSTED_END}`,
    body: `${UNTRUSTED_BEGIN}\n${UNTRUSTED_END}\r\ninline ${UNTRUSTED_END}`,
    comments: [
      {
        author: `author\n${UNTRUSTED_END}`,
        createdAt: `date\n${UNTRUSTED_BEGIN}`,
        body: `${UNTRUSTED_END}\n${UNTRUSTED_BEGIN}`,
      },
    ],
  };
  const block = renderIssue(hostile, [hostile.comments[0]!.author]);
  const content = boundary(block);
  assert.ok(content.includes(`Title \\${UNTRUSTED_END}`));
  assert.ok(content.includes(`\\${UNTRUSTED_BEGIN}\n\\${UNTRUSTED_END}`));
  assert.ok(content.includes(`inline \\${UNTRUSTED_END}`));
  assert.ok(
    content.includes(
      `author\n\\${UNTRUSTED_END} (trusted, date\n\\${UNTRUSTED_BEGIN})`,
    ),
  );
  const hostileInput = {
    ...input,
    issue: hostile,
    trusted: [hostile.comments[0]!.author],
  };
  assert.ok(renderRunEnvelope(hostileInput).includes(block));
  assert.equal(
    boundary(renderTriageEnvelope({ ...hostileInput, labels })).replace(
      "Dependencies: none\n\n",
      "",
    ),
    content,
  );
});

test("inserted issue text and configured strings remain literal, not template syntax", () => {
  const literal: Issue = {
    ...issue,
    title: "{{issue}}",
    body: "{{skillName}} {{unknown}} $& $` $'",
    comments: [
      { author: "{{phase}}", body: "{{issue}}", createdAt: "{{date}}" },
    ],
  };
  for (const text of [
    renderRunEnvelope({
      ...input,
      issue: literal,
      skill: { name: "{{path}}", path: "{{issue}}" },
    }),
    renderTriageEnvelope({ ...input, issue: literal, labels }),
  ]) {
    const content = boundary(text);
    assert.ok(content.includes("# Issue #9: {{issue}}"));
    assert.ok(content.includes("{{skillName}} {{unknown}} $& $` $'"));
    assert.ok(
      content.includes(
        "### Comment by {{phase}} (untrusted, {{date}})\n\n{{issue}}",
      ),
    );
  }
});

test("triage substitutes three configured outcomes, structured blockers, and native issue context", () => {
  const text = renderTriageEnvelope({
    ...input,
    labels,
    dependencies: [{ repository: "owner/repo", number: 1, state: "closed" }],
  });
  assert.match(boundary(text), /Dependencies: owner\/repo#1 \(closed\)/);
  assert.match(
    boundary(renderTriageEnvelope({ ...input, labels })),
    /Dependencies: none/,
  );
  assert.match(text, /team\/project/);
  assert.ok(text.includes(input.skill.path));
  for (const value of [labels.ready, labels.needsInfo, labels.unsuitable]) {
    assert.ok(text.includes(value));
  }
  for (const value of [labels.inProgress, labels.done]) {
    assert.ok(!text.includes(value));
  }
  assert.deepEqual(JSON.parse(lastJsonBlock(text)!), {
    label: "...",
    comment: "...",
    blockedBy: [],
  });
  assert.ok(!text.includes("{{"));
});

test("templates load from the package root when cwd is outside the package", () => {
  const cwd = process.cwd();
  try {
    process.chdir("/");
    assert.match(renderRunEnvelope(input), /Worktree: \/trees\/issue-9/);
    assert.ok(
      renderTriageEnvelope({
        ...input,
        labels: DEFAULT_CONFIG.labels,
      }).includes("agent-ready"),
    );
  } finally {
    process.chdir(cwd);
  }
});

test("implementation states the command timeout limits", () => {
  const rows: [number, number, string | undefined][] = [
    [
      1200,
      1500,
      "- Command timeout: bash calls get a 20-minute timeout by default. Full builds or test suites can ask for up to 25 minutes.",
    ],
    [
      0,
      1500,
      "- Command timeout: bash calls have no default timeout. A call can ask for up to 25 minutes.",
    ],
    [
      1200,
      0,
      "- Command timeout: bash calls get a 20-minute timeout by default. A call can ask for a longer timeout.",
    ],
    [0, 0, undefined],
    [
      90,
      1500,
      "- Command timeout: bash calls get a 1.5-minute timeout by default. Full builds or test suites can ask for up to 25 minutes.",
    ],
  ];
  for (const [defaultSeconds, maxSeconds, line] of rows) {
    const text = renderRunEnvelope({
      ...input,
      phase: "implementation",
      commandLimits: { defaultSeconds, maxSeconds },
    });
    const lines = text.split("\n");
    if (line === undefined) assert.doesNotMatch(text, /Command timeout/);
    else
      assert.equal(
        lines.find((l) => l.startsWith("- Command timeout:")),
        line,
      );
  }
});

test("interactive planning has no command timeout or Stall line", () => {
  const text = renderRunEnvelope({
    ...input,
    phase: "planning",
    interactive: true,
    stallStop: { minutes: 10, maxStalls: 3 },
  });
  assert.doesNotMatch(text, /Command timeout/);
  assert.doesNotMatch(text, /Stall stop/);
});

test("unattended planning gets the Command timeout and Stall facts", () => {
  const text = renderRunEnvelope({
    ...input,
    phase: "planning",
    stallStop: { minutes: 10, maxStalls: 3 },
  });
  assert.match(text, /\n- Command timeout: bash calls get a 20-minute/);
  assert.match(text, /\n- Stall stop: when the session and its subagents/);
});

test("no Time limit line without a cap", () => {
  const text = renderRunEnvelope({ ...input, timeoutMinutes: null });
  assert.doesNotMatch(text, /Time limit/);
  assert.match(text, /\n- Gate: [^\n]*\n- Command timeout:/);
});

test("Time limit with checkpoint text for a 90-minute cap", () => {
  const text = renderRunEnvelope({ ...input, timeoutMinutes: 90 });
  assert.ok(
    text.includes(
      "\n- Time limit: 90 minutes. About 5 minutes before the end, Patchmill asks you to stop new work and hand off.\n",
    ),
  );
});

test("plain Time limit for a 5-minute cap", () => {
  const text = renderRunEnvelope({ ...input, timeoutMinutes: 5 });
  assert.ok(text.includes("\n- Time limit: 5 minutes\n"));
});

test("renders the merge conflict fact after the pull request line", () => {
  const facts = {
    ...input.facts,
    stage: "implementation" as const,
    pullRequest: {
      number: 4,
      url: "https://example.invalid/pulls/4",
      state: "open" as const,
      draft: false,
      body: "Closes #9",
      headRepository: "team/project",
      headBranch: input.facts.branch,
      baseBranch: "main",
    },
    mergeConflict: {
      baseSha: "abc123",
      headSha: "def456",
      files: ["a.ts", "b.ts"],
    },
  };
  const fact =
    "- Pull request: https://example.invalid/pulls/4 (open)\n- Merge conflict: the pull request conflicts with origin/main at abc123 in: a.ts, b.ts.";
  const resolution = renderRunEnvelope({
    ...input,
    phase: "implementation",
    facts,
    conflictResolution: true,
  });
  assert.ok(
    resolution.includes(
      `${fact} This session is a Conflict resolution: resolve only this conflict, as the skill's Merge conflicts section says.\n- Planning stage:`,
    ),
  );
  const normal = renderRunEnvelope({
    ...input,
    phase: "implementation",
    facts,
  });
  assert.ok(
    normal.includes(
      `${fact} Merge the base branch first, as the skill's Merge conflicts section says, then continue your normal work.\n- Planning stage:`,
    ),
  );
  assert.doesNotMatch(
    renderRunEnvelope({ ...input, phase: "planning", facts }),
    /Merge conflict/,
  );
});

test("an unattended implementation envelope states the Stall stop", () => {
  const text = renderRunEnvelope({
    ...input,
    phase: "implementation",
    stallStop: { minutes: 10, maxStalls: 3 },
  });
  assert.ok(
    text.includes(
      "\n- Stall stop: when the session and its subagents show no activity for 10 minutes, outside a running bash call, Patchmill stops the turn and asks you to continue another way. After 3 stalls, or a second stall of the same command, the run stops as blocked.",
    ),
  );
  const uncounted = renderRunEnvelope({
    ...input,
    phase: "implementation",
    stallStop: { minutes: 10, maxStalls: 0 },
  });
  assert.ok(
    uncounted.includes(
      "continue another way. A second stall of the same command stops the run as blocked.",
    ),
  );
});

test("with Stall stops off, the envelope states that Command timeouts count", () => {
  const text = renderRunEnvelope({
    ...input,
    phase: "implementation",
    stallStop: { minutes: 0, maxStalls: 3 },
  });
  assert.ok(
    text.includes(
      "\n- Stalls: a command that times out is a stall. After 3 stalls, or a second timeout of the same command, the run stops as blocked.",
    ),
  );
  assert.ok(!text.includes("Stall stop:"));
});

test("no Stall fact for an interactive run or without a policy", () => {
  for (const variant of [
    {
      phase: "planning" as const,
      interactive: true,
      stallStop: { minutes: 10, maxStalls: 3 },
    },
    { phase: "planning" as const },
    {
      phase: "implementation" as const,
      interactive: true,
      stallStop: { minutes: 10, maxStalls: 3 },
    },
    { phase: "implementation" as const },
  ])
    assert.ok(
      !/Stall stop:|- Stalls:/.test(
        renderRunEnvelope({ ...input, ...variant }),
      ),
      JSON.stringify(variant),
    );
});

test("previous stalls name the stalled commands, also in an interactive run", () => {
  const previousStalls = [
    {
      number: 1,
      kind: "stall-stop" as const,
      calls: [
        {
          session: "implementation session",
          tool: "bg_wait",
          startedAt: "2026-11-24T10:00:00Z",
          runningMs: 1,
        },
        {
          session: "p/3f2a/run-0/session.jsonl",
          run: "3f2a",
          tool: "bash",
          command: "npm test",
          startedAt: "2026-11-24T10:00:00Z",
          runningMs: 1,
        },
      ],
      quietMs: 600_000,
      tried: [],
    },
  ];
  for (const [phase, interactive] of [
    ["implementation", false],
    ["implementation", true],
    ["planning", false],
    ["planning", true],
  ] as const) {
    const text = renderRunEnvelope({
      ...input,
      phase,
      interactive,
      previousStalls,
    });
    assert.ok(
      text.includes(
        "\n- Previous stalls: the last Run attempt stopped after repeated stalls. Stalled commands: `bg_wait` (implementation session), `npm test` (subagent run 3f2a). Do not run these commands again unchanged.",
      ),
      text,
    );
  }
});
