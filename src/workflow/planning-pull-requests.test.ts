import assert from "node:assert/strict";
import test from "node:test";
import type { GitWorktreeStrategyConfig } from "../git/types.ts";
import {
  PlanningPullRequestMarkerError,
  parsePlanningPullRequestMarker,
  phaseWorkspaceIdentity,
  planningPhasePlan,
  planningPullRequestBody,
  planningPullRequestTitle,
  renderPlanningPullRequestMarker,
  type PlannedPhase,
  type PlanningGateSnapshot,
} from "./planning-pull-requests.ts";

const phaseCases: Array<{
  gates: PlanningGateSnapshot;
  expected: readonly PlannedPhase[];
}> = [
  {
    gates: { specRequired: false, planRequired: false },
    expected: [
      {
        kind: "implementation",
        artifactKinds: ["spec", "plan"],
        pullRequestRequired: true,
      },
    ],
  },
  {
    gates: { specRequired: true, planRequired: false },
    expected: [
      {
        kind: "spec",
        artifactKinds: ["spec"],
        pullRequestRequired: true,
      },
      {
        kind: "implementation",
        artifactKinds: ["plan"],
        pullRequestRequired: true,
      },
    ],
  },
  {
    gates: { specRequired: false, planRequired: true },
    expected: [
      {
        kind: "plan",
        artifactKinds: ["spec", "plan"],
        pullRequestRequired: true,
      },
      {
        kind: "implementation",
        artifactKinds: [],
        pullRequestRequired: true,
      },
    ],
  },
  {
    gates: { specRequired: true, planRequired: true },
    expected: [
      {
        kind: "spec",
        artifactKinds: ["spec"],
        pullRequestRequired: true,
      },
      {
        kind: "plan",
        artifactKinds: ["plan"],
        pullRequestRequired: true,
      },
      {
        kind: "implementation",
        artifactKinds: [],
        pullRequestRequired: true,
      },
    ],
  },
];

test("planning phase plan covers all spec and plan gate combinations", () => {
  for (const entry of phaseCases) {
    assert.deepEqual(planningPhasePlan(entry.gates), entry.expected);
  }
});

const strategy: GitWorktreeStrategyConfig = {
  baseBranch: "main",
  baseRef: "HEAD",
  remote: "origin",
  branchPrefix: "agent/issue-",
  worktreeDir: ".worktrees",
  worktreePrefix: "patchmill-issue-",
  slugLength: 48,
  allowDirectLand: false,
};

test("phase workspace identity appends the phase outside the issue slug", () => {
  assert.deepEqual(
    phaseWorkspaceIdentity({
      issueNumber: 184,
      title: "Define provider-neutral planning pull request foundations",
      phase: "plan",
      strategy,
    }),
    {
      branch:
        "agent/issue-184-define-provider-neutral-planning-pull-request-fo-plan",
      worktreePath:
        ".worktrees/patchmill-issue-184-define-provider-neutral-planning-pull-request-fo-plan",
    },
  );
});

test("planning pull request marker renders and parses exact identity", () => {
  const marker = renderPlanningPullRequestMarker({
    issueNumber: 184,
    phase: "spec",
  });

  assert.equal(
    marker,
    "<!-- patchmill:planning-pr-v1 issue=184 phase=spec -->",
  );
  assert.deepEqual(parsePlanningPullRequestMarker(`Header\n\n${marker}\n`), {
    workflowVersion: "planning-pr-v1",
    issueNumber: 184,
    phase: "spec",
  });
});

test("marker parser returns undefined when no planning marker exists", () => {
  assert.equal(parsePlanningPullRequestMarker("Refs #184"), undefined);
});

test("marker parser skips only valid unescaped code spans", () => {
  const marker = renderPlanningPullRequestMarker({
    issueNumber: 184,
    phase: "spec",
  });
  const identity = {
    workflowVersion: "planning-pr-v1",
    issueNumber: 184,
    phase: "spec",
  } as const;

  const escapedBacktick = "\\`";
  assert.equal(parsePlanningPullRequestMarker(`\`${marker}\``), undefined);
  assert.deepEqual(
    parsePlanningPullRequestMarker(
      `${escapedBacktick}${marker}${escapedBacktick}`,
    ),
    identity,
  );
  assert.deepEqual(
    parsePlanningPullRequestMarker("`" + marker + "```"),
    identity,
  );
});

test("marker parser ignores fenced and indented Markdown code blocks", () => {
  const marker = renderPlanningPullRequestMarker({
    issueNumber: 184,
    phase: "spec",
  });

  const codeBodies = [
    ["```html", marker, "```"].join("\n"),
    ["~~~html", marker, "~~~"].join("\n"),
    ["> ~~~html", `> ${marker}`, "> ~~~"].join("\n"),
    ["- ~~~html", `  ${marker}`, "  ~~~"].join("\n"),
    `    ${marker}`,
    `\t${marker}`,
  ];
  for (const body of codeBodies) {
    assert.equal(parsePlanningPullRequestMarker(body), undefined);
  }
  assert.deepEqual(
    parsePlanningPullRequestMarker(["```", marker, "```", marker].join("\n")),
    {
      workflowVersion: "planning-pr-v1",
      issueNumber: 184,
      phase: "spec",
    },
  );
});

test("marker parser does not span blank-line-separated Markdown blocks", () => {
  const marker = renderPlanningPullRequestMarker({
    issueNumber: 184,
    phase: "spec",
  });

  assert.deepEqual(
    parsePlanningPullRequestMarker(["`", "", marker, "", "`"].join("\n")),
    {
      workflowVersion: "planning-pr-v1",
      issueNumber: 184,
      phase: "spec",
    },
  );
});

test("marker parser rejects duplicate and invalid planning markers", () => {
  const invalidBodies = [
    [
      "<!-- patchmill:planning-pr-v1 issue=184 phase=spec -->",
      "<!-- patchmill:planning-pr-v1 issue=184 phase=spec -->",
    ].join("\n"),
    "<!-- patchmill:planning-pr-v2 issue=184 phase=spec -->",
    "<!-- patchmill:planning-pr-v1 issue=0 phase=spec -->",
    "<!-- patchmill:planning-pr-v1 issue=184 phase=review -->",
    "<!-- patchmill:planning-pr-v1 issue=184 phase=spec",
  ];

  for (const body of invalidBodies) {
    assert.throws(
      () => parsePlanningPullRequestMarker(body),
      PlanningPullRequestMarkerError,
    );
  }
});

test("marker parser rejects a malformed marker alongside a valid marker", () => {
  const body = [
    "<!-- patchmill:planning-pr-v1 issue=184 phase=spec -->",
    "<!-- patchmill:planning-pr-v1 issue=185 phase=plan",
  ].join("\n");

  assert.throws(
    () => parsePlanningPullRequestMarker(body),
    PlanningPullRequestMarkerError,
  );
});

const closingKeyword = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#\d+/iu;

test("planning title identifies the phase and issue without untrusted issue text", () => {
  const specTitle = planningPullRequestTitle({
    issueNumber: 184,
    phase: "spec",
  });
  const planTitle = planningPullRequestTitle({
    issueNumber: 184,
    phase: "plan",
  });

  assert.equal(specTitle, "Spec for #184");
  assert.equal(planTitle, "Plan for #184");
  assert.doesNotMatch(specTitle, closingKeyword);
  assert.doesNotMatch(planTitle, closingKeyword);
});

test("planning body is non-closing and lists each artifact path once", () => {
  const body = planningPullRequestBody({
    issueNumber: 184,
    phase: "spec",
    artifactPaths: [
      "docs/specs/issue-184-design.md",
      "docs/specs/issue-184-design.md",
    ],
  });

  assert.match(body, /^Refs #184$/mu);
  assert.match(body, /^Spec$/mu);
  assert.equal(body.match(/docs\/specs\/issue-184-design\.md/gu)?.length, 1);
  assert.match(body, /Merge this pull request to unlock the next phase\./u);
  assert.match(body, /<!-- patchmill:planning-pr-v1 issue=184 phase=spec -->/u);
  assert.doesNotMatch(body, closingKeyword);
});

test("planning body rejects artifact paths that can create Markdown blocks", () => {
  for (const artifactPath of [
    "docs/specs/issue-184.md\n\nCloses #184",
    "docs/specs/issue-184.md\n~~~",
  ]) {
    assert.throws(
      () =>
        planningPullRequestBody({
          issueNumber: 184,
          phase: "spec",
          artifactPaths: [artifactPath],
        }),
      RangeError,
    );
  }
});
