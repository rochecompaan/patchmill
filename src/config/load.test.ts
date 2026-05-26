import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "./defaults.ts";
import { loadPatchmillConfig } from "./load.ts";

test("loadPatchmillConfig returns defaults when no file or env is present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const config = await loadPatchmillConfig(dir, {}, []);
  assert.equal(config.host.login, "triage-agent");
  assert.deepEqual(config.skills, DEFAULT_PATCHMILL_CONFIG.skills);
  assert.equal(config.paths.runStateDir, join(dir, ".patchmill/runs"));
  assert.equal(config.git.worktreePrefix, "patchmill-issue-");
  assert.equal(config.cleanupHook, undefined);
});

test("loadPatchmillConfig clones default arrays for each load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const first = await loadPatchmillConfig(dir, {}, []);
  const second = await loadPatchmillConfig(dir, {}, []);

  assert.notStrictEqual(
    first.labels.priorities,
    DEFAULT_PATCHMILL_CONFIG.labels.priorities,
  );
  assert.notStrictEqual(
    first.paths.cleanStatusIgnorePrefixes,
    DEFAULT_PATCHMILL_CONFIG.paths.cleanStatusIgnorePrefixes,
  );
  assert.notStrictEqual(first.labels.priorities, second.labels.priorities);
  assert.notStrictEqual(
    first.paths.cleanStatusIgnorePrefixes,
    second.paths.cleanStatusIgnorePrefixes,
  );
  assert.notStrictEqual(first.skills, DEFAULT_PATCHMILL_CONFIG.skills);
  assert.notStrictEqual(first.skills, second.skills);
  assert.notStrictEqual(
    first.projectPolicy,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy,
  );
  assert.notStrictEqual(first.projectPolicy, second.projectPolicy);
  assert.notStrictEqual(
    first.projectPolicy.contextFileNames,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.contextFileNames,
  );
  assert.notStrictEqual(
    first.projectPolicy.contextFileNames,
    second.projectPolicy.contextFileNames,
  );
  assert.notStrictEqual(
    first.projectPolicy.validation,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.validation,
  );
  assert.notStrictEqual(
    first.projectPolicy.validation,
    second.projectPolicy.validation,
  );
  assert.notStrictEqual(
    first.projectPolicy.validation.rules,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.validation.rules,
  );
  assert.notStrictEqual(
    first.projectPolicy.validation.rules,
    second.projectPolicy.validation.rules,
  );
  assert.notStrictEqual(
    first.projectPolicy.validation.forbiddenSubstitutions,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.validation.forbiddenSubstitutions,
  );
  assert.notStrictEqual(
    first.projectPolicy.validation.forbiddenSubstitutions,
    second.projectPolicy.validation.forbiddenSubstitutions,
  );
  assert.notStrictEqual(
    first.projectPolicy.directLand,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.directLand,
  );
  assert.notStrictEqual(
    first.projectPolicy.directLand,
    second.projectPolicy.directLand,
  );
  assert.notStrictEqual(
    first.projectPolicy.visualEvidence,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.visualEvidence,
  );
  assert.notStrictEqual(
    first.projectPolicy.visualEvidence,
    second.projectPolicy.visualEvidence,
  );
  assert.notStrictEqual(
    first.projectPolicy.visualEvidence.prEvidenceExample,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.visualEvidence.prEvidenceExample,
  );
  assert.notStrictEqual(
    first.projectPolicy.visualEvidence.prEvidenceExample,
    second.projectPolicy.visualEvidence.prEvidenceExample,
  );
  assert.notStrictEqual(
    first.projectPolicy.pi,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.pi,
  );
  assert.notStrictEqual(first.projectPolicy.pi, second.projectPolicy.pi);
  assert.notStrictEqual(
    first.projectPolicy.pi.taskContract,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.pi.taskContract,
  );
  assert.notStrictEqual(
    first.projectPolicy.pi.taskContract,
    second.projectPolicy.pi.taskContract,
  );
  assert.notStrictEqual(
    first.projectPolicy.pi.taskContract.todoTags,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.pi.taskContract.todoTags,
  );
  assert.notStrictEqual(
    first.projectPolicy.pi.taskContract.todoTags,
    second.projectPolicy.pi.taskContract.todoTags,
  );
  assert.notStrictEqual(
    first.projectPolicy.pi.taskContract.planTodoBodyRequirements,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.pi.taskContract
      .planTodoBodyRequirements,
  );
  assert.notStrictEqual(
    first.projectPolicy.pi.taskContract.planTodoBodyRequirements,
    second.projectPolicy.pi.taskContract.planTodoBodyRequirements,
  );
  assert.notStrictEqual(
    first.projectPolicy.pi.taskContract.implementationTodoBodyRequirements,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.pi.taskContract
      .implementationTodoBodyRequirements,
  );
  assert.notStrictEqual(
    first.projectPolicy.pi.taskContract.implementationTodoBodyRequirements,
    second.projectPolicy.pi.taskContract.implementationTodoBodyRequirements,
  );
  assert.notStrictEqual(
    first.projectPolicy.pi.taskContract.doneStatuses,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.pi.taskContract.doneStatuses,
  );
  assert.notStrictEqual(
    first.projectPolicy.pi.taskContract.doneStatuses,
    second.projectPolicy.pi.taskContract.doneStatuses,
  );
  first.labels.priorities.push("priority:urgent");
  first.paths.cleanStatusIgnorePrefixes.push("scratch/");
  first.skills.planning = "project-planning";
  first.projectPolicy.contextFileNames.push("CONTRIBUTING.md");
  first.projectPolicy.validation.rules.push({
    category: "Unit tests",
    commands: ["npm test"],
  });
  first.projectPolicy.validation.forbiddenSubstitutions.push(
    "Do not skip tests.",
  );
  first.projectPolicy.directLand.targetBranch = "release";
  first.projectPolicy.visualEvidence.prEvidenceExample!.caption =
    "Changed caption";
  first.projectPolicy.pi.taskContract.todoRoot = ".patchmill/todos";
  first.projectPolicy.pi.taskContract.todoTags.push("custom-tag");
  first.projectPolicy.pi.taskContract.planTodoBodyRequirements.push("owner");
  first.projectPolicy.pi.taskContract.implementationTodoBodyRequirements.push(
    "result",
  );
  first.projectPolicy.pi.taskContract.doneStatuses.push("verified");

  assert.deepEqual(
    second.labels.priorities,
    DEFAULT_PATCHMILL_CONFIG.labels.priorities,
  );
  assert.deepEqual(
    second.paths.cleanStatusIgnorePrefixes,
    DEFAULT_PATCHMILL_CONFIG.paths.cleanStatusIgnorePrefixes,
  );
  assert.deepEqual(second.skills, DEFAULT_PATCHMILL_CONFIG.skills);
  assert.deepEqual(
    second.projectPolicy.contextFileNames,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.contextFileNames,
  );
  assert.deepEqual(
    second.projectPolicy.validation.rules,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.validation.rules,
  );
  assert.deepEqual(
    second.projectPolicy.validation.forbiddenSubstitutions,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.validation.forbiddenSubstitutions,
  );
  assert.equal(
    second.projectPolicy.directLand.targetBranch,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.directLand.targetBranch,
  );
  assert.deepEqual(
    second.projectPolicy.visualEvidence.prEvidenceExample,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.visualEvidence.prEvidenceExample,
  );
  assert.deepEqual(
    second.projectPolicy.pi.taskContract,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.pi.taskContract,
  );
  assert.equal(second.cleanupHook, DEFAULT_PATCHMILL_CONFIG.cleanupHook);
});

test("loadPatchmillConfig clones configured visual evidence fields for each load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({
      projectPolicy: {
        visualEvidence: {
          referenceScreenshotPaths: [
            "docs/reference/web/",
            "docs/reference/mobile/",
          ],
          prEvidenceExample: {
            screenshotPath: ".tmp/factory-after.png",
            caption: "Factory dashboard after the change",
            referencePaths: ["docs/reference/web/dashboard.png"],
          },
        },
      },
    }),
  );

  const first = await loadPatchmillConfig(dir, {}, []);
  const second = await loadPatchmillConfig(dir, {}, []);

  assert.notStrictEqual(
    first.projectPolicy.visualEvidence,
    second.projectPolicy.visualEvidence,
  );
  assert.notStrictEqual(
    first.projectPolicy.visualEvidence.referenceScreenshotPaths,
    second.projectPolicy.visualEvidence.referenceScreenshotPaths,
  );
  assert.notStrictEqual(
    first.projectPolicy.visualEvidence.prEvidenceExample,
    second.projectPolicy.visualEvidence.prEvidenceExample,
  );
  assert.notStrictEqual(
    first.projectPolicy.visualEvidence.prEvidenceExample?.referencePaths,
    second.projectPolicy.visualEvidence.prEvidenceExample?.referencePaths,
  );

  first.projectPolicy.visualEvidence.referenceScreenshotPaths?.push(
    "docs/reference/tablet/",
  );
  first.projectPolicy.visualEvidence.prEvidenceExample?.referencePaths?.push(
    "docs/reference/web/secondary.png",
  );

  assert.deepEqual(
    second.projectPolicy.visualEvidence.referenceScreenshotPaths,
    ["docs/reference/web/", "docs/reference/mobile/"],
  );
  assert.deepEqual(second.projectPolicy.visualEvidence.prEvidenceExample, {
    screenshotPath: ".tmp/factory-after.png",
    caption: "Factory dashboard after the change",
    referencePaths: ["docs/reference/web/dashboard.png"],
  });
});

test("loadPatchmillConfig parses top-level skills config", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-skills-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      skills: {
        triage: "project-triage",
        planning: "project-planning",
        implementation: "project-implementation",
        toolchain: "bootstrapping-tilt-worktrees",
        visualEvidence: "capturing-proof-screenshots",
      },
    }),
    "utf8",
  );

  const config = await loadPatchmillConfig(repoRoot, {}, []);

  assert.deepEqual(config.skills, {
    triage: "project-triage",
    planning: "project-planning",
    implementation: "project-implementation",
    toolchain: "bootstrapping-tilt-worktrees",
    visualEvidence: "capturing-proof-screenshots",
  });
});

test("loadPatchmillConfig rejects unknown skills keys", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-invalid-skills-config-"),
  );
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      skills: {
        planning: "project-planning",
        extra: "unknown-skill",
      },
    }),
    "utf8",
  );

  await assert.rejects(
    () => loadPatchmillConfig(repoRoot, {}, []),
    /skills\.extra must be a supported skill stage/,
  );
});

test("loadPatchmillConfig rejects blank skills", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-blank-skills-config-"),
  );
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      skills: { planning: "" },
    }),
    "utf8",
  );

  await assert.rejects(
    () => loadPatchmillConfig(repoRoot, {}, []),
    /skills\.planning must be a non-empty string/,
  );
});

test("loadPatchmillConfig rejects removed skill workflow settings", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-removed-skill-settings-"),
  );
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      projectPolicy: {
        toolchainInstruction: "old toolchain prompt fragment",
        hostToolingInstruction: "old host prompt fragment",
        directLand: {
          policyText: "old landing prompt fragment",
        },
        visualEvidence: {
          policyText: "old visual prompt fragment",
          webScreenshotSkill: "old-web-skill",
          mobileScreenshotSkill: "old-mobile-skill",
          reviewerExpectations: ["old reviewer prompt fragment"],
        },
        pi: {
          subagentWorkflowInstruction: "old implementation prompt fragment",
          todoWorkflowInstruction: "old todo prompt fragment",
        },
      },
    }),
    "utf8",
  );

  await assert.rejects(
    () => loadPatchmillConfig(repoRoot, {}, []),
    /toolchainInstruction|hostToolingInstruction|policyText|webScreenshotSkill|mobileScreenshotSkill|reviewerExpectations|subagentWorkflowInstruction|todoWorkflowInstruction/,
  );
});

test("loadPatchmillConfig applies patchmill.config.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({
      host: { login: "bot-login" },
      skills: {
        triage: "project-triage",
        planning: "project-planning",
        implementation: "project-implementation",
        toolchain: "bootstrapping-tilt-worktrees",
        visualEvidence: "capturing-proof-screenshots",
      },
      paths: {
        plansDir: "engineering/plans",
        cleanStatusIgnorePrefixes: ["scratch/", ".patchmill/custom-runs/"],
      },
      git: {
        baseRef: "refs/remotes/upstream/release/1.2",
        remote: "upstream",
        branchPrefix: "patchmill/issue-",
        worktreePrefix: "pm-issue-",
        slugLength: 32,
      },
      cleanupHook: "./scripts/cleanup.sh",
      projectPolicy: {
        projectName: "Factory",
        contextFileNames: ["AGENTS.md", "CONTRIBUTING.md"],
        validation: {
          rules: [{ category: "Unit tests", commands: ["pnpm test"] }],
          forbiddenSubstitutions: ["Do not skip required validation."],
        },
        directLand: {
          targetBranch: "release/1.2",
        },
        visualEvidence: {
          referenceScreenshotPaths: [
            "docs/reference/web/",
            "docs/reference/mobile/",
          ],
          prEvidenceExample: {
            screenshotPath: ".tmp/factory-after.png",
            caption: "Factory dashboard after the change",
            referencePaths: ["docs/reference/web/dashboard.png"],
          },
        },
        pi: {
          taskContract: {
            todoRoot: ".patchmill/todos",
            todoTitlePattern: "work-<number>-step-<two-digit-number>-<slug>",
            todoTags: ["delivery", "work-<number>"],
            planTodoBodyRequirements: [
              "purpose",
              "plan checklist item",
              "checkpoints",
            ],
            implementationTodoBodyRequirements: [
              "purpose",
              "plan checklist item",
              "checkpoints",
              "latest validation",
            ],
            doneStatuses: ["shipped", "verified"],
            planTaskHeadingPattern: "### Step <number> - <label>",
            openTaskTodosBlockFinalHandoff: false,
          },
        },
        planRequiresApproval: true,
      },
    }),
  );
  const config = await loadPatchmillConfig(dir, {}, []);
  assert.equal(config.host.login, "bot-login");
  assert.deepEqual(config.skills, {
    triage: "project-triage",
    planning: "project-planning",
    implementation: "project-implementation",
    toolchain: "bootstrapping-tilt-worktrees",
    visualEvidence: "capturing-proof-screenshots",
  });
  assert.equal(config.paths.plansDir, join(dir, "engineering/plans"));
  assert.deepEqual(config.paths.cleanStatusIgnorePrefixes, [
    "scratch/",
    ".patchmill/custom-runs/",
  ]);
  assert.equal(config.git.baseRef, "refs/remotes/upstream/release/1.2");
  assert.equal(config.git.remote, "upstream");
  assert.equal(config.git.branchPrefix, "patchmill/issue-");
  assert.equal(config.git.worktreePrefix, "pm-issue-");
  assert.equal(config.git.slugLength, 32);
  assert.equal(config.cleanupHook, "./scripts/cleanup.sh");
  assert.equal(config.projectPolicy.projectName, "Factory");
  assert.deepEqual(config.projectPolicy.contextFileNames, [
    "AGENTS.md",
    "CONTRIBUTING.md",
  ]);
  assert.deepEqual(config.projectPolicy.validation.rules, [
    { category: "Unit tests", commands: ["pnpm test"] },
  ]);
  assert.deepEqual(config.projectPolicy.validation.forbiddenSubstitutions, [
    "Do not skip required validation.",
  ]);
  assert.equal(config.projectPolicy.directLand.targetBranch, "release/1.2");
  assert.deepEqual(
    config.projectPolicy.visualEvidence.referenceScreenshotPaths,
    ["docs/reference/web/", "docs/reference/mobile/"],
  );
  assert.deepEqual(config.projectPolicy.visualEvidence.prEvidenceExample, {
    screenshotPath: ".tmp/factory-after.png",
    caption: "Factory dashboard after the change",
    referencePaths: ["docs/reference/web/dashboard.png"],
  });
  assert.deepEqual(config.projectPolicy.pi.taskContract, {
    todoRoot: ".patchmill/todos",
    todoTitlePattern: "work-<number>-step-<two-digit-number>-<slug>",
    todoTags: ["delivery", "work-<number>"],
    planTodoBodyRequirements: ["purpose", "plan checklist item", "checkpoints"],
    implementationTodoBodyRequirements: [
      "purpose",
      "plan checklist item",
      "checkpoints",
      "latest validation",
    ],
    doneStatuses: ["shipped", "verified"],
    planTaskHeadingPattern: "### Step <number> - <label>",
    openTaskTodosBlockFinalHandoff: false,
  });
  assert.equal(config.projectPolicy.planRequiresApproval, true);
});

test("loadPatchmillConfig applies host-login CLI overrides last", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const config = await loadPatchmillConfig(
    dir,
    { PATCHMILL_HOST_LOGIN: "env-login" },
    ["--host-login", "cli-login"],
  );
  assert.equal(config.host.login, "cli-login");
});

test("loadPatchmillConfig accepts tea-login as a host-login alias", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const config = await loadPatchmillConfig(dir, {}, [
    "--tea-login",
    "cli-login",
  ]);
  assert.equal(config.host.login, "cli-login");
});

test("loadPatchmillConfig absolutizes paths from a relative repo root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({
      paths: {
        worktreeDir: "custom/../trees",
        cleanStatusIgnorePrefixes: ["scratch/", "logs/run-state/"],
      },
    }),
  );
  const relativeRoot = relative(process.cwd(), dir);
  const config = await loadPatchmillConfig(relativeRoot, {}, []);
  assert.equal(
    config.paths.runStateDir,
    resolve(relativeRoot, ".patchmill/runs"),
  );
  assert.equal(
    config.paths.worktreeDir,
    resolve(relativeRoot, "custom/../trees"),
  );
  assert.deepEqual(config.paths.cleanStatusIgnorePrefixes, [
    "scratch/",
    "logs/run-state/",
  ]);
});

test("loadPatchmillConfig reports invalid config field types", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({
      paths: { plansDir: null },
    }),
  );

  await assert.rejects(loadPatchmillConfig(dir, {}, []), (error: unknown) => {
    assert(error instanceof Error);
    assert.equal(error.name, "Error");
    assert.match(
      error.message,
      /Invalid patchmill\.config\.json: paths\.plansDir must be a string; received null/,
    );
    return true;
  });
});

test("loadPatchmillConfig rejects non-string cleanupHook", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({ cleanupHook: ["./scripts/cleanup.sh"] }),
  );

  await assert.rejects(
    () => loadPatchmillConfig(dir, {}, []),
    /cleanupHook must be a string/,
  );
});

test("loadPatchmillConfig rejects removed cleanupHooks config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({ cleanupHooks: [{ name: "legacy-cleanup" }] }),
  );

  await assert.rejects(
    () => loadPatchmillConfig(dir, {}, []),
    /cleanupHooks must be removed; use cleanupHook as a repository-relative shell script path/,
  );
});

test("loadPatchmillConfig reports invalid clean-status ignore prefixes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({
      paths: { cleanStatusIgnorePrefixes: [".patchmill/runs/", 17] },
    }),
  );

  await assert.rejects(loadPatchmillConfig(dir, {}, []), (error: unknown) => {
    assert(error instanceof Error);
    assert.equal(error.name, "Error");
    assert.match(
      error.message,
      /Invalid patchmill\.config\.json: paths\.cleanStatusIgnorePrefixes must be an array of strings/,
    );
    return true;
  });
});

test("loadPatchmillConfig reports invalid git slug lengths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({
      git: { slugLength: 0 },
    }),
  );

  await assert.rejects(loadPatchmillConfig(dir, {}, []), (error: unknown) => {
    assert(error instanceof Error);
    assert.equal(error.name, "Error");
    assert.match(
      error.message,
      /Invalid patchmill\.config\.json: git\.slugLength must be a positive integer/,
    );
    return true;
  });
});

test("loadPatchmillConfig reports invalid project policy validation rules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({
      projectPolicy: {
        validation: {
          rules: [{ category: "Unit tests", commands: [17] }],
        },
      },
    }),
  );

  await assert.rejects(loadPatchmillConfig(dir, {}, []), (error: unknown) => {
    assert(error instanceof Error);
    assert.equal(error.name, "Error");
    assert.match(
      error.message,
      /Invalid patchmill\.config\.json: projectPolicy\.validation\.rules\[0\]\.commands must be an array of strings/,
    );
    return true;
  });
});

test("loadPatchmillConfig reports invalid task contract todo tags", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({
      projectPolicy: {
        pi: {
          taskContract: {
            todoTags: ["agent-issue", 17],
          },
        },
      },
    }),
  );

  await assert.rejects(loadPatchmillConfig(dir, {}, []), (error: unknown) => {
    assert(error instanceof Error);
    assert.equal(error.name, "Error");
    assert.match(
      error.message,
      /Invalid patchmill\.config\.json: projectPolicy\.pi\.taskContract\.todoTags must be an array of strings/,
    );
    return true;
  });
});

test("loadPatchmillConfig reports invalid visual evidence example types", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({
      projectPolicy: {
        visualEvidence: {
          prEvidenceExample: { screenshotPath: 17 },
        },
      },
    }),
  );

  await assert.rejects(loadPatchmillConfig(dir, {}, []), (error: unknown) => {
    assert(error instanceof Error);
    assert.equal(error.name, "Error");
    assert.match(
      error.message,
      /Invalid patchmill\.config\.json: projectPolicy\.visualEvidence\.prEvidenceExample\.screenshotPath must be a string/,
    );
    return true;
  });
});

test("loadPatchmillConfig parses triage state map", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-state-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      labels: {
        ready: "ready-for-agent",
        needsInfo: "needs-info",
        unsuitable: "ready-for-human",
        "in-progress": "in-progress",
      },
      triage: {
        stateMap: {
          "ready-for-agent": "agent-ready",
          "needs-info": "needs-info",
          "ready-for-human": "agent-unsuitable",
          wontfix: "agent-unsuitable",
        },
      },
    }),
    "utf8",
  );

  const config = await loadPatchmillConfig(repoRoot, {}, []);

  assert.deepEqual(config.triage.stateMap, {
    "ready-for-agent": "agent-ready",
    "needs-info": "needs-info",
    "ready-for-human": "agent-unsuitable",
    wontfix: "agent-unsuitable",
  });
  assert.equal(config.labels.inProgress, "in-progress");
});

test("loadPatchmillConfig defaults triage state map from merged labels", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-defaults-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      labels: {
        ready: "ready-for-agent",
        needsInfo: "needs-info",
        unsuitable: "manual-only",
      },
    }),
    "utf8",
  );

  const config = await loadPatchmillConfig(repoRoot, {}, []);

  assert.deepEqual(config.triage.stateMap, {
    "ready-for-agent": "agent-ready",
    "needs-info": "needs-info",
    "manual-only": "agent-unsuitable",
  });
});

test("loadPatchmillConfig rejects invalid triage state map buckets", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-invalid-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      triage: {
        stateMap: {
          "agent-ready": "agent-ready",
          deferred: "later",
        },
      },
    }),
    "utf8",
  );

  await assert.rejects(
    () => loadPatchmillConfig(repoRoot, {}, []),
    /triage\.stateMap\.deferred must be one of agent-ready, needs-info, agent-unsuitable/,
  );
});

test("loadPatchmillConfig rejects state maps that omit ready label mapping", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-ready-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      labels: { ready: "ready-for-agent" },
      triage: {
        stateMap: {
          "needs-info": "needs-info",
        },
      },
    }),
    "utf8",
  );

  await assert.rejects(
    () => loadPatchmillConfig(repoRoot, {}, []),
    /triage\.stateMap must map ready label ready-for-agent to agent-ready/,
  );
});

test('loadPatchmillConfig parses dashed labels["in-progress"] input', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-in-progress-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      labels: {
        "in-progress": "claimed",
      },
    }),
    "utf8",
  );

  const config = await loadPatchmillConfig(repoRoot, {}, []);

  assert.equal(config.labels.inProgress, "claimed");
});

test("loadPatchmillConfig rejects removed labels.inProgress input", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-in-progress-removed-"),
  );
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      labels: {
        inProgress: "claimed",
      },
    }),
    "utf8",
  );

  await assert.rejects(
    () => loadPatchmillConfig(repoRoot, {}, []),
    /labels\.inProgress must be removed; use labels\["in-progress"\]/,
  );
});
