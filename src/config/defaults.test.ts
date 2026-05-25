import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_POLICY } from "../policy/defaults.ts";
import { DEFAULT_PATCHMILL_SKILLS } from "../workflow/skills.ts";
import { DEFAULT_PATCHMILL_CONFIG } from "./defaults.ts";

test("defaults match the current patchmill baseline configuration", () => {
  assert.equal(
    DEFAULT_PATCHMILL_CONFIG.projectPolicy,
    DEFAULT_PATCHMILL_POLICY,
  );
  assert.equal(DEFAULT_PATCHMILL_CONFIG.skills, DEFAULT_PATCHMILL_SKILLS);
  assert.deepEqual(DEFAULT_PATCHMILL_CONFIG, {
    host: {
      provider: "forgejo-tea",
      login: "triage-agent",
    },
    pi: {
      triageThinking: "high",
    },
    labels: {
      ready: "agent-ready",
      needsInfo: "needs-info",
      unsuitable: "agent-unsuitable",
      inProgress: "in-progress",
      done: "agent-done",
      blocked: "blocked",
      types: ["bug", "enhancement", "docs", "chore", "test"],
      priorities: [
        "priority:critical",
        "priority:high",
        "priority:medium",
        "priority:low",
      ],
    },
    skills: DEFAULT_PATCHMILL_SKILLS,
    paths: {
      plansDir: "docs/plans",
      runStateDir: ".patchmill/runs",
      triageLogDir: ".patchmill/triage-runs",
      worktreeDir: ".worktrees",
      cleanStatusIgnorePrefixes: [
        ".patchmill/runs/",
        ".patchmill/triage-runs/",
      ],
    },
    git: {
      baseBranch: "main",
      baseRef: "HEAD",
      remote: "origin",
      branchPrefix: "agent/issue-",
      worktreePrefix: "patchmill-issue-",
      slugLength: 48,
      allowDirectLand: true,
    },
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
  });
});
