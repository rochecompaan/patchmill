import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PATCHMILL_POLICY } from "../../../policy/defaults.ts";
import { DEFAULT_PATCHMILL_SKILLS } from "../../../workflow/skills.ts";
import {
  createPlanningArtifactAgent,
  resolvePlanningPhaseArtifacts,
  runPlanningPhaseArtifacts,
} from "./planning-phase-artifacts.ts";

const oid = (letter: string) => letter.repeat(40);
const base = {
  remote: "origin",
  baseBranch: "main",
  baseOid: oid("a"),
  artifactCandidates: { spec: [], plan: [] },
};
const workspace = {
  runId: "123e4567-e89b-42d3-a456-426614174000",
  phase: "plan" as const,
  identity: { branch: "planning/plan", worktreePath: "/repo/.worktrees/plan" },
  remote: "origin",
  baseBranch: "main",
  baseOid: oid("a"),
  headOid: oid("a"),
  cleanup: { state: "ready" as const },
};
const issue = {
  number: 188,
  title: "Example",
  labels: [],
  body: "",
  state: "open" as const,
};
test("production artifact agent keeps Pi operator state in the primary repository", async () => {
  const calls: Array<{ cwd?: string; env?: NodeJS.ProcessEnv }> = [];
  const agent = createPlanningArtifactAgent({
    runner: {
      async run(_command, _args, options) {
        calls.push(options ?? {});
        return {
          code: 0,
          stdout: JSON.stringify({
            status: "spec-created",
            specPath: "docs/specs/example.md",
            commit: oid("b"),
          }),
          stderr: "",
        };
      },
    },
    repoRoot: "/primary",
    skills: DEFAULT_PATCHMILL_SKILLS,
    taskContract: DEFAULT_PATCHMILL_POLICY.pi.taskContract,
    issueNumber: 188,
  });
  await agent.run({ kind: "spec", cwd: "/phase-worktree", prompt: "prompt" });
  assert.equal(calls[0]?.cwd, "/phase-worktree");
  assert.equal(
    calls[0]?.env?.PI_CODING_AGENT_DIR,
    "/primary/.patchmill/pi-agent",
  );
  assert.equal(calls[0]?.env?.PI_TODO_PATH, "/primary/.pi/todos");
});
test("resolves mixed base candidates in planner order", () => {
  const result = resolvePlanningPhaseArtifacts({
    phase: {
      kind: "plan",
      artifactKinds: ["spec", "plan"],
      pullRequestRequired: true,
    },
    base: {
      ...base,
      artifactCandidates: { spec: ["docs/specs/example.md"], plan: [] },
    },
  });
  assert.deepEqual(result, {
    kind: "workspace-required",
    artifacts: [
      {
        kind: "spec",
        path: "docs/specs/example.md",
        source: "remote-base",
        commitOid: oid("a"),
      },
    ],
    missing: ["plan"],
  });
});
test("blocks ambiguous base artifacts before agent execution", () => {
  assert.throws(
    () =>
      resolvePlanningPhaseArtifacts({
        phase: {
          kind: "spec",
          artifactKinds: ["spec"],
          pullRequestRequired: true,
        },
        base: {
          ...base,
          artifactCandidates: {
            spec: ["docs/specs/a.md", "docs/specs/b.md"],
            plan: [],
          },
        },
      }),
    /ambiguous-base-artifact/,
  );
});
test("checkpoints spec before running plan", async () => {
  const events: string[] = [];
  const prompts: string[] = [];
  let head = oid("a");
  const result = await runPlanningPhaseArtifacts({
    issue,
    phase: {
      kind: "plan",
      artifactKinds: ["spec", "plan"],
      pullRequestRequired: true,
    },
    current: {
      kind: "plan",
      status: "workspace-ready",
      base,
      workspace,
      artifacts: [],
    },
    repoRoot: "/repo",
    specsDir: "/repo/docs/specs",
    plansDir: "/repo/docs/plans",
    artifactDate: new Date("2026-09-08"),
    agent: {
      async run({ kind, prompt }) {
        prompts.push(prompt);
        events.push(`agent:${kind}`);
        head = kind === "spec" ? oid("b") : oid("c");
        return kind === "spec"
          ? {
              status: "spec-created",
              specPath: "docs/specs/2026-09-08-issue-188-example-design.md",
              commit: head,
            }
          : {
              status: "plan-created",
              planPath: "docs/plans/2026-09-08-issue-188-example.md",
              commit: head,
            };
      },
    },
    git: {
      async verifyArtifactCommit({ artifactPath }) {
        events.push(`git:${artifactPath.includes("specs") ? "spec" : "plan"}`);
      },
    },
    checkpoint: async (phase) => {
      events.push(
        `checkpoint:${phase.artifacts.map((item) => item.kind).join("+")}`,
      );
    },
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    skills: DEFAULT_PATCHMILL_SKILLS,
    triageLabels: { ready: "agent-ready", needsInfo: "needs-info" },
  });
  assert.equal(result.kind, "workspace-ready");
  assert.deepEqual(events, [
    "agent:spec",
    "git:spec",
    "checkpoint:spec",
    "agent:plan",
    "git:plan",
    "checkpoint:spec+plan",
  ]);
  assert.ok(prompts.every((prompt) => !prompt.includes("/repo/docs/")));
  if (result.kind === "workspace-ready")
    assert.deepEqual(
      result.phase.artifacts.map((item) => item.commitOid),
      [oid("b"), oid("c")],
    );
});

test("resumes from a saved spec checkpoint without invoking spec again", async () => {
  const calls: string[] = [];
  const result = await runPlanningPhaseArtifacts({
    issue,
    phase: {
      kind: "plan",
      artifactKinds: ["spec", "plan"],
      pullRequestRequired: true,
    },
    current: {
      kind: "plan",
      status: "workspace-ready",
      base,
      workspace: { ...workspace, headOid: oid("b") },
      artifacts: [
        {
          kind: "spec",
          path: "docs/specs/example.md",
          source: "workspace",
          commitOid: oid("b"),
        },
      ],
    },
    repoRoot: "/repo",
    specsDir: "/repo/docs/specs",
    plansDir: "/repo/docs/plans",
    artifactDate: new Date("2026-09-08"),
    agent: {
      async run({ kind }) {
        calls.push(`agent:${kind}`);
        return {
          status: "plan-created",
          planPath: "docs/plans/2026-09-08-issue-188-example.md",
          commit: oid("c"),
        };
      },
    },
    git: {
      async verifyArtifactCommit({ previousHeadOid }) {
        calls.push(`git:${previousHeadOid}`);
      },
    },
    checkpoint: async (phase) => {
      calls.push(`checkpoint:${phase.workspace.headOid}`);
    },
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    skills: DEFAULT_PATCHMILL_SKILLS,
    triageLabels: { ready: "agent-ready", needsInfo: "needs-info" },
  });
  assert.equal(result.kind, "workspace-ready");
  assert.deepEqual(calls, [
    `agent:plan`,
    `git:${oid("b")}`,
    `checkpoint:${oid("c")}`,
  ]);
  assert.equal(result.kind, "workspace-ready");
  if (result.kind === "workspace-ready")
    assert.deepEqual(result.phase.artifacts, [
      {
        kind: "spec",
        path: "docs/specs/example.md",
        source: "workspace",
        commitOid: oid("b"),
      },
      {
        kind: "plan",
        path: "docs/plans/2026-09-08-issue-188-example.md",
        source: "workspace",
        commitOid: oid("c"),
      },
    ]);
});

test("stops on blocked spec or checkpoint failure before the plan agent", async () => {
  const calls: string[] = [];
  const input = {
    issue,
    phase: {
      kind: "plan" as const,
      artifactKinds: ["spec", "plan"] as const,
      pullRequestRequired: true,
    },
    current: {
      kind: "plan" as const,
      status: "workspace-ready" as const,
      base,
      workspace,
      artifacts: [],
    },
    repoRoot: "/repo",
    specsDir: "/repo/docs/specs",
    plansDir: "/repo/docs/plans",
    artifactDate: new Date("2026-09-08"),
    git: {
      async verifyArtifactCommit() {
        calls.push("git");
      },
    },
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    skills: DEFAULT_PATCHMILL_SKILLS,
    triageLabels: { ready: "agent-ready", needsInfo: "needs-info" },
  };
  const blocked = await runPlanningPhaseArtifacts({
    ...input,
    agent: {
      async run({ kind }) {
        calls.push(`agent:${kind}`);
        return { status: "blocked", reason: "needs input", questions: [] };
      },
    },
    checkpoint: async () => {
      calls.push("checkpoint");
    },
  });
  assert.equal(blocked.kind, "blocked");
  assert.deepEqual(calls, ["agent:spec"]);
  calls.length = 0;
  await assert.rejects(
    () =>
      runPlanningPhaseArtifacts({
        ...input,
        agent: {
          async run({ kind }) {
            calls.push(`agent:${kind}`);
            return {
              status: "spec-created",
              specPath: "docs/specs/2026-09-08-issue-188-example-design.md",
              commit: oid("b"),
            };
          },
        },
        checkpoint: async () => {
          calls.push("checkpoint");
          throw new Error("store failed");
        },
      }),
    /store failed/,
  );
  assert.deepEqual(calls, ["agent:spec", "git", "checkpoint"]);
});

test("rejects invalid artifact path forms before the Git validation seam", async () => {
  for (const [label, specPath] of [
    ["parent escape", "../escape.md"],
    ["absolute path", "/repo/docs/specs/escape.md"],
    ["backslash path", "docs\\specs\\escape.md"],
    ["wrong configured directory", "docs/plans/escape.md"],
  ] as const) {
    let gitCalled = false;
    await assert.rejects(
      () =>
        runPlanningPhaseArtifacts({
          issue,
          phase: {
            kind: "spec",
            artifactKinds: ["spec"],
            pullRequestRequired: true,
          },
          current: {
            kind: "spec",
            status: "workspace-ready",
            base,
            workspace: {
              ...workspace,
              phase: "spec",
              identity: {
                branch: "planning/spec",
                worktreePath: "/workspace",
              },
            },
            artifacts: [],
          },
          repoRoot: "/repo",
          specsDir: "/repo/docs/specs",
          plansDir: "/repo/docs/plans",
          artifactDate: new Date("2026-09-08"),
          agent: {
            async run() {
              return {
                status: "spec-created",
                specPath,
                commit: oid("b"),
              };
            },
          },
          git: {
            async verifyArtifactCommit() {
              gitCalled = true;
            },
          },
          checkpoint: async () => {},
          projectPolicy: DEFAULT_PATCHMILL_POLICY,
          skills: DEFAULT_PATCHMILL_SKILLS,
          triageLabels: { ready: "agent-ready", needsInfo: "needs-info" },
        }),
      /invalid-artifact-path/,
      label,
    );
    assert.equal(gitCalled, false, label);
  }
});

test("propagates delegated Git validation failures and rejects malformed agent results", async () => {
  const common = {
    issue,
    phase: {
      kind: "spec" as const,
      artifactKinds: ["spec"] as const,
      pullRequestRequired: true,
    },
    current: {
      kind: "spec" as const,
      status: "workspace-ready" as const,
      base,
      workspace: {
        ...workspace,
        phase: "spec",
        identity: { branch: "planning/spec", worktreePath: "/workspace" },
      },
      artifacts: [],
    },
    repoRoot: "/repo",
    specsDir: "/repo/docs/specs",
    plansDir: "/repo/docs/plans",
    artifactDate: new Date("2026-09-08"),
    checkpoint: async () => {},
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    skills: DEFAULT_PATCHMILL_SKILLS,
    triageLabels: { ready: "agent-ready", needsInfo: "needs-info" },
  };
  await assert.rejects(
    () =>
      runPlanningPhaseArtifacts({
        ...common,
        agent: {
          async run() {
            return {
              status: "spec-created",
              specPath: "docs/specs/2026-09-08-issue-188-example-design.md",
              commit: oid("b"),
            };
          },
        },
        git: {
          async verifyArtifactCommit() {
            throw new Error("dirty workspace");
          },
        },
      }),
    /dirty workspace/,
  );
  await assert.rejects(
    () =>
      runPlanningPhaseArtifacts({
        ...common,
        agent: {
          async run() {
            return {
              status: "plan-created",
              planPath: "docs/plans/x.md",
              commit: oid("b"),
            };
          },
        },
        git: {
          async verifyArtifactCommit() {
            assert.fail("unexpected");
          },
        },
      }),
    /unexpected-agent-result/,
  );
});
