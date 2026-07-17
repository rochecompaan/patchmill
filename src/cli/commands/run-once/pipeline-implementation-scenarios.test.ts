import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_POLICY } from "../../../policy/defaults.ts";
import {
  buildSkillPackMetadata,
  hashText,
} from "../../../workflow/skill-pack.ts";
import { bundledVisualEvidenceSkillPath } from "../../../workflow/skills.ts";
import { runStatePath } from "./run-state.ts";
import { runOneIssue } from "./pipeline.ts";
import { assertNoLegacyProjectText } from "../../../../test-support/legacy-project-text.ts";
import {
  DEFAULT_LABEL_NAMES,
  issue,
  issueListPayload,
  labelListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";
import {
  createMockRunner,
  promptPath,
  writePiSessionMessage,
} from "../../../../test-support/run-once/mock-runner.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import {
  collectProgressEvents,
  gitBaseContainmentResult,
} from "../../../../test-support/run-once/assertions.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");

function withRepo(args: string[], repoRoot: string): string[] {
  const separator = args.indexOf("--");
  if (separator === -1) return [...args, "--repo", repoRoot];
  return [
    ...args.slice(0, separator),
    "--repo",
    repoRoot,
    ...args.slice(separator),
  ];
}

async function writeTodo(
  repoRoot: string,
  id: string,
  title: string,
  status: string,
): Promise<void> {
  const dir = join(repoRoot, ".pi", "todos");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${id}.md`),
    `${JSON.stringify({ id, title, status })}\n\nbody\n`,
    "utf8",
  );
}

test("runOneIssue creates a missing plan, then creates a worktree and runs Pi from that worktree", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    15,
    ["agent-ready", "enhancement", "priority:critical"],
    "Ship automation pipeline",
  );
  const expectedPlanPath =
    "docs/plans/2026-05-09-issue-15-ship-automation-pipeline.md";
  let piCalls = 0;
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: labelListPayload(
          DEFAULT_LABEL_NAMES.filter((label) => label !== "agent-done"),
        ),
        stderr: "",
      };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "worktree") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "branch") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      piCalls += 1;
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.equal(
        call.env?.PI_CODING_AGENT_DIR,
        join(config.repoRoot, ".patchmill", "pi-agent"),
      );
      if (piCalls === 1) {
        const finalText = `created plan\n{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"abc123"}`;
        await writePiSessionMessage(call, "plan output\n", {
          input: 10000,
          output: 500,
          totalTokens: 10500,
        });
        assert.equal(call.cwd, config.repoRoot);
        assert.match(prompt, /Create an implementation plan/);
        return { code: 0, stdout: finalText, stderr: "" };
      }

      assert.equal(
        call.cwd,
        join(
          config.repoRoot,
          ".worktrees/patchmill-issue-15-ship-automation-pipeline",
        ),
      );
      const finalText = `done\n{"status":"pr-created","prUrl":"https://forgejo.example/pr/15","branch":"agent/issue-15-ship-automation-pipeline","commits":["def456"],"validation":["node --test ok"],"reviewSummary":"reviewed"}`;
      await writePiSessionMessage(call, "implementation output\n", {
        input: 20000,
        output: 1000,
        totalTokens: 21000,
      });
      assert.match(prompt, /Implement repository issue #15/);
      assertNoLegacyProjectText(prompt);
      assert.match(prompt, /Branch: agent\/issue-15-ship-automation-pipeline/);
      return { code: 0, stdout: finalText, stderr: "" };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const logPath = join(config.runStateDir, "run.jsonl");
  const streamedPiOutput: string[] = [];
  const result = await runOneIssue(runner, config, {
    now: NOW,
    progress,
    logPath,
    streamPiOutput: (chunk) => streamedPiOutput.push(chunk),
  });

  assert.equal(result.status, "pr-created");
  assert.equal(result.logPath, logPath);
  const stepLabels = events.flatMap((event) =>
    event.step?.type === "step-start" ? [event.step.label] : [],
  );
  assert.ok(stepLabels.includes("select issue"), stepLabels.join("\n"));
  assert.ok(stepLabels.includes("commit plan"), stepLabels.join("\n"));
  assert.ok(stepLabels.includes("create worktree"), stepLabels.join("\n"));
  assert.ok(
    stepLabels.includes("final result pr-created"),
    stepLabels.join("\n"),
  );
  assert.deepEqual(
    events
      .filter(
        (event) =>
          event.level !== "debug" &&
          event.stage !== "step" &&
          event.stage !== "run",
      )
      .map((event) => event.message),
    [
      "listing open issues",
      "selected #15 Ship automation pipeline",
      "checking issue branch base containment",
      "hydrating issue artifact content",
      "reading deterministic issue artifact sources",
      "checking repository status",
      "ensuring in-progress label exists",
      "claimed #15: agent-ready -> in-progress",
      "creating worktree .worktrees/patchmill-issue-15-ship-automation-pipeline",
      "finding spec",
      "creating spec with pi",
      "finding plan",
      "creating plan with pi",
      "running implementation with pi",
      "PR created: https://forgejo.example/pr/15",
      "removed local worktree .worktrees/patchmill-issue-15-ship-automation-pipeline",
      "deleted local branch agent/issue-15-ship-automation-pipeline",
    ],
  );
  assert.equal(result.planPath, expectedPlanPath);
  assert.equal(result.branch, "agent/issue-15-ship-automation-pipeline");
  assert.equal(
    result.worktreePath,
    ".worktrees/patchmill-issue-15-ship-automation-pipeline",
  );
  assert.equal(result.prUrl, "https://forgejo.example/pr/15");
  assert.equal(piCalls, 3);
  assert.deepEqual(streamedPiOutput, []);

  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 2);
  assert.deepEqual(
    editCalls[0]?.args,
    withRepo(
      [
        "issues",
        "edit",
        "15",
        "--remove-labels",
        "agent-ready",
        "--add-labels",
        "in-progress",
      ],
      config.repoRoot,
    ),
  );
  assert.deepEqual(
    editCalls[1]?.args,
    withRepo(
      [
        "issues",
        "edit",
        "15",
        "--remove-labels",
        "in-progress",
        "--add-labels",
        "agent-done",
      ],
      config.repoRoot,
    ),
  );

  const doneLabelCreate = runner.calls.find(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create" &&
      call.args.includes("agent-done"),
  );
  assert.ok(doneLabelCreate);

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 15), "utf8"),
  );
  assert.equal(runState.status, "finished");
  assert.equal(runState.planPath, expectedPlanPath);
  assert.equal(runState.planCommit, "abc123");
  assert.equal(runState.branch, "agent/issue-15-ship-automation-pipeline");
  assert.equal(
    runState.worktreePath,
    ".worktrees/patchmill-issue-15-ship-automation-pipeline",
  );
  assert.equal(runState.implementingAt, NOW.toISOString());
});

test("runOneIssue resolves implementation skills from the config repo root without expanding metadata", async () => {
  const baseConfig = await makeConfig({ dryRun: false, execute: true });
  const config = {
    ...baseConfig,
    skills: {
      ...baseConfig.skills,
      planning: "skills/local-planning/SKILL.md",
      implementation: ".patchmill/skills/subagent-driven-development",
    },
  };
  const selected = issue(16, ["agent-ready", "bug"], "Use local skills");
  const expectedPlanPath = "docs/plans/2026-05-09-issue-16-use-local-skills.md";
  const worktreeRoot = join(
    config.repoRoot,
    ".worktrees",
    "patchmill-issue-16-use-local-skills",
  );
  let piCalls = 0;
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    ) {
      await mkdir(
        join(
          worktreeRoot,
          ".patchmill",
          "skills",
          "subagent-driven-development",
        ),
        { recursive: true },
      );
      await mkdir(
        join(worktreeRoot, ".patchmill", "skills", "requesting-code-review"),
        { recursive: true },
      );
      const implementationSkill = "# implementation\n";
      const reviewSkill = "# review\n";
      await writeFile(
        join(
          worktreeRoot,
          ".patchmill",
          "skills",
          "subagent-driven-development",
          "SKILL.md",
        ),
        implementationSkill,
        "utf8",
      );
      await writeFile(
        join(
          worktreeRoot,
          ".patchmill",
          "skills",
          "requesting-code-review",
          "SKILL.md",
        ),
        reviewSkill,
        "utf8",
      );
      await writeFile(
        join(worktreeRoot, ".patchmill", "skills", "patchmill-skill-pack.json"),
        JSON.stringify(
          buildSkillPackMetadata([
            {
              path: ".patchmill/skills/subagent-driven-development/SKILL.md",
              sha256: hashText(implementationSkill),
            },
            {
              path: ".patchmill/skills/requesting-code-review/SKILL.md",
              sha256: hashText(reviewSkill),
            },
          ]),
        ),
        "utf8",
      );
      return { code: 0, stdout: "", stderr: "" };
    }
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      piCalls += 1;
      const skillPaths = call.args.flatMap((arg, index) =>
        arg === "--skill" ? [call.args[index + 1] ?? ""] : [],
      );

      if (piCalls === 1) {
        assert.deepEqual(skillPaths, [
          join(config.repoRoot, "skills", "local-planning", "SKILL.md"),
        ]);
        return {
          code: 0,
          stdout: `{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"abc123"}`,
          stderr: "",
        };
      }

      assert.deepEqual(skillPaths, [
        join(
          config.repoRoot,
          ".patchmill",
          "skills",
          "subagent-driven-development",
          "SKILL.md",
        ),
        bundledVisualEvidenceSkillPath(),
      ]);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/16",
          branch: "agent/issue-16-use-local-skills",
          commits: ["def456"],
          validation: ["node --test ok"],
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(piCalls, 3);
});

test("runOneIssue renders configured project policy visual evidence fields in the implementation prompt", async () => {
  const baseConfig = await makeConfig({ dryRun: false, execute: true });
  const config = {
    ...baseConfig,
    baseBranch: "release/2.0",
    remote: "upstream",
    skills: {
      ...baseConfig.skills,
      visualEvidence: "sentinel-screenshots",
      landing: "sentinel-landing",
    },
    projectPolicy: {
      ...DEFAULT_PATCHMILL_POLICY,
      projectName: "Sentinel",
      directLand: {
        targetBranch: "ignored-by-runner",
      },
      visualEvidence: {
        referenceScreenshotPaths: [
          "docs/sentinel/web/",
          "docs/sentinel/mobile/",
        ],
        prEvidenceExample: {
          screenshotPath: "docs/sentinel/web/sentinel-after.png",
          caption: "Sentinel after the change",
          referencePaths: ["docs/sentinel/web/hero.png"],
        },
      },
    },
  };
  const selected = issue(
    16,
    ["agent-ready"],
    "Render configured policy prompt",
  );
  const planPath =
    "docs/plans/2026-05-09-issue-16-render-configured-policy-prompt.md";
  const worktreeRoot = join(
    config.repoRoot,
    ".worktrees/patchmill-issue-16-render-configured-policy-prompt",
  );

  let piCalls = 0;
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      piCalls += 1;
      const prompt = await readFile(promptPath(call.args), "utf8");
      if (/Create a design spec/.test(prompt)) {
        return {
          code: 0,
          stdout: `{"status":"spec-created","specPath":"docs/specs/spec.md","commit":"spec123"}`,
          stderr: "",
        };
      }
      if (/Create an implementation plan/.test(prompt)) {
        assert.match(
          prompt,
          /Create an implementation plan for Sentinel issue #16/,
        );
        return {
          code: 0,
          stdout: `{"status":"plan-created","planPath":"${planPath}","commit":"abc123"}`,
          stderr: "",
        };
      }

      await writeTodo(
        worktreeRoot,
        "task-1",
        "issue-16-task-01-render-configured-policy-prompt",
        "closed",
      );
      assert.match(prompt, /Implement Sentinel issue #16/);
      assert.match(
        prompt,
        /If the issue changes visible UI, use the configured visual evidence skill: `sentinel-screenshots`\./,
      );
      assert.match(
        prompt,
        /Use the configured landing skill for the direct-land versus PR decision: `sentinel-landing`\./,
      );
      assert.match(
        prompt,
        /Look under `docs\/sentinel\/web\/` and `docs\/sentinel\/mobile\/`/,
      );
      assert.match(
        prompt,
        /"screenshotPath": "docs\/sentinel\/web\/sentinel-after\.png"/,
      );
      assert.match(
        prompt,
        /Update local `release\/2\.0` from the `upstream` remote\./,
      );
      assert.doesNotMatch(
        prompt,
        /capturing proof screenshots|Reviewer must confirm Sentinel screenshot approval|policyText|webScreenshotSkill|mobileScreenshotSkill/,
      );
      assertNoLegacyProjectText(prompt);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/16",
          branch: "agent/issue-16-render-configured-policy-prompt",
          commits: ["def456"],
          validation: ["node --test ok"],
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(piCalls, 3);
});

test("runOneIssue uses the configured worktree strategy for workspace names and prompt instructions", async () => {
  const baseConfig = await makeConfig({ dryRun: false, execute: true });
  const config = {
    ...baseConfig,
    baseBranch: "release/1.2",
    baseRef: "refs/remotes/upstream/release/1.2",
    remote: "upstream",
    skills: {
      ...baseConfig.skills,
      landing: "project-landing",
    },
    branchPrefix: "patchmill/issue-",
    worktreeDir: join(baseConfig.repoRoot, ".patchmill", "worktrees"),
    worktreePrefix: "pm-issue-",
  };
  const selected = issue(16, ["agent-ready"], "Use custom worktrees");
  const planPath = join(
    config.plansDir,
    "2026-05-09-issue-16-use-custom-worktrees.md",
  );
  await writeFile(planPath, "# Plan\n", "utf8");

  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea") return { code: 0, stdout: "", stderr: "" };
    const preflight = gitBaseContainmentResult(call);
    if (preflight) return preflight;
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    ) {
      assert.deepEqual(call.args, [
        "worktree",
        "add",
        "-b",
        "patchmill/issue-16-use-custom-worktrees",
        ".patchmill/worktrees/pm-issue-16-use-custom-worktrees",
        "refs/remotes/upstream/release/1.2",
      ]);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      const promptPath = call.args.at(-1)?.slice(1);
      assert.ok(promptPath);
      const prompt = await readFile(promptPath, "utf8");
      assert.match(prompt, /Branch: patchmill\/issue-16-use-custom-worktrees/);
      assert.match(
        prompt,
        /Worktree: \.patchmill\/worktrees\/pm-issue-16-use-custom-worktrees/,
      );
      assert.match(
        prompt,
        /Update local `release\/1\.2` from the `upstream` remote\./,
      );
      assert.match(
        prompt,
        /Push `release\/1\.2` to `upstream` without force-pushing\./,
      );
      assert.match(
        prompt,
        /Push the branch to `upstream` and open a pull request using the repository's configured host tooling\./,
      );
      assert.match(
        prompt,
        /Include `Closes #16` in the pull request description\/body\./,
      );
      assert.match(
        prompt,
        /tea pulls create --description "\$\(cat "\$file"\)"/,
      );
      assert.match(prompt, /literal `\\n` escape text/);
      assert.match(prompt, /gh pr create --body-file/);
      assert.match(
        prompt,
        /Summary\n\n- Implemented change summary\.\n\n## Validation\n\n- npm test\n\n## Reviews\n\n- Review completed\.\n\nCloses #16/,
      );
      assert.equal(
        call.cwd,
        join(
          config.repoRoot,
          ".patchmill/worktrees/pm-issue-16-use-custom-worktrees",
        ),
      );
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/16",
          branch: "patchmill/issue-16-use-custom-worktrees",
          commits: ["abc123"],
          validation: ["node --test ok"],
        }),
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(result.branch, "patchmill/issue-16-use-custom-worktrees");
  assert.equal(
    result.worktreePath,
    ".patchmill/worktrees/pm-issue-16-use-custom-worktrees",
  );
  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 16), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(runState.branch, "patchmill/issue-16-use-custom-worktrees");
  assert.equal(
    runState.worktreePath,
    ".patchmill/worktrees/pm-issue-16-use-custom-worktrees",
  );
  assert.ok(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args.join(" ") ===
          "rev-parse --verify refs/remotes/upstream/release/1.2^{commit}",
    ),
  );
  assert.ok(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args.join(" ") ===
          "log --oneline refs/remotes/upstream/release/1.2..refs/remotes/upstream/release/1.2",
    ),
  );
});

test("runOneIssue honors configured clean-status ignore prefixes", async () => {
  const baseConfig = await makeConfig({ dryRun: false, execute: true });
  const config = {
    ...baseConfig,
    runStateDir: join(baseConfig.repoRoot, ".patchmill", "runs"),
    cleanStatusIgnorePrefixes: ["scratch-logs/"],
  };
  const selected = issue(18, ["agent-ready"], "Ignore configured scratch logs");
  const planPath = join(
    config.plansDir,
    "2026-05-09-issue-18-ignore-configured-scratch-logs.md",
  );
  await writeFile(planPath, "# Plan\n", "utf8");

  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea") return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status") {
      return {
        code: 0,
        stdout: "?? scratch-logs/run-2026-05-09T12-00-00-000Z.jsonl\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/18",
          branch: "agent/issue-18-ignore-configured-scratch-logs",
          commits: ["abc123"],
          validation: ["node --test ok"],
        }),
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, {
    now: NOW,
    logPath: join(config.runStateDir, "run-2026-05-09T12-00-00-000Z.jsonl"),
  });

  assert.equal(result.status, "pr-created");
  assert.equal(
    result.worktreePath,
    ".worktrees/patchmill-issue-18-ignore-configured-scratch-logs",
  );
});
