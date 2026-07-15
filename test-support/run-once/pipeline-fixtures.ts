import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../src/config/defaults.ts";
import { DEFAULT_PATCHMILL_POLICY } from "../../src/policy/defaults.ts";
import { createPatchmillLabelCatalog } from "../../src/policy/label-catalog.ts";
import { createWorkflowApprovalPolicy } from "../../src/workflow/approval-policy.ts";
import { runOneIssue } from "../../src/cli/commands/run-once/pipeline.ts";
import {
  runStatePath,
  writeRunState,
} from "../../src/cli/commands/run-once/run-state.ts";
import type {
  AgentIssueConfig,
  AgentIssuePipelineResult,
  CommandResult,
  IssueSummary,
} from "../../src/cli/commands/run-once/types.ts";
import { issue, issueListPayload, labelListPayload } from "./issue-fixtures.ts";
import {
  createMockRunner,
  promptPath,
  type Call,
  type MockRunner,
} from "./mock-runner.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");

export function specAndPlanApprovalPolicy() {
  return approvalPolicy({ specRequired: true, planRequired: true });
}

export function approvalPolicy(
  overrides: {
    specRequired?: boolean;
    specApprovedLabel?: string;
    planRequired?: boolean;
    planReviewLabel?: string;
    planApprovedLabel?: string;
  } = {},
) {
  return createWorkflowApprovalPolicy({
    ...DEFAULT_PATCHMILL_CONFIG.workflow,
    specApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
      required:
        overrides.specRequired ??
        DEFAULT_PATCHMILL_CONFIG.workflow.specApproval.required,
      approvedLabel:
        overrides.specApprovedLabel ??
        DEFAULT_PATCHMILL_CONFIG.workflow.specApproval.approvedLabel,
    },
    planApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
      required:
        overrides.planRequired ??
        DEFAULT_PATCHMILL_CONFIG.workflow.planApproval.required,
      reviewLabel:
        overrides.planReviewLabel ??
        DEFAULT_PATCHMILL_CONFIG.workflow.planApproval.reviewLabel,
      approvedLabel:
        overrides.planApprovedLabel ??
        DEFAULT_PATCHMILL_CONFIG.workflow.planApproval.approvedLabel,
    },
  });
}

export async function makeConfig(
  overrides: Partial<AgentIssueConfig> = {},
): Promise<AgentIssueConfig> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-issue-pipeline-"));
  const specsDir = join(repoRoot, "docs", "specs");
  const plansDir = join(repoRoot, "docs", "plans");
  const runStateDir = join(repoRoot, ".patchmill", "runs");
  await mkdir(specsDir, { recursive: true });
  await mkdir(plansDir, { recursive: true });
  const labelCatalog = createPatchmillLabelCatalog({
    ...DEFAULT_PATCHMILL_CONFIG,
    labels: overrides.triagePolicy?.labels ?? DEFAULT_PATCHMILL_CONFIG.labels,
    triage: overrides.triagePolicy
      ? { stateMap: overrides.triagePolicy.stateMap }
      : DEFAULT_PATCHMILL_CONFIG.triage,
  });

  return {
    repoRoot,
    dryRun: true,
    execute: false,
    planOnly: false,
    host: { provider: "forgejo-tea", login: "" },
    specsDir,
    plansDir,
    runStateDir,
    worktreeDir: join(repoRoot, ".worktrees"),
    cleanStatusIgnorePrefixes: [".patchmill/runs/", ".patchmill/triage-runs/"],
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    readyLabel: "agent-ready",
    issueLimit: 1,
    labelCatalog,
    approvalPolicy: createWorkflowApprovalPolicy(
      DEFAULT_PATCHMILL_CONFIG.workflow,
    ),
    baseBranch: "main",
    baseRef: "HEAD",
    remote: "origin",
    branchPrefix: "agent/issue-",
    worktreePrefix: "patchmill-issue-",
    slugLength: 48,
    allowDirectLand: true,
    skills: { ...DEFAULT_PATCHMILL_CONFIG.skills },
    ...overrides,
  };
}

type PlanApprovedImplementationScenario = {
  issueNumber: number;
  title: string;
  issueLabels?: string[];
  planPath?: string;
  configOverrides?: Partial<AgentIssueConfig>;
  onPi?: (input: {
    call: Call;
    prompt: string;
    config: AgentIssueConfig;
    piPrompts: string[];
  }) => CommandResult | Promise<CommandResult>;
};

export async function runPlanApprovedImplementationScenario(
  scenario: PlanApprovedImplementationScenario,
): Promise<{
  config: AgentIssueConfig;
  runner: MockRunner;
  result: AgentIssuePipelineResult;
  piPrompts: string[];
  selected: IssueSummary;
}> {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    ...scenario.configOverrides,
  });
  const planPath =
    scenario.planPath ??
    `docs/plans/2026-05-14-issue-${scenario.issueNumber}-scenario.md`;
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  const selected = issue(
    scenario.issueNumber,
    scenario.issueLabels ?? ["plan-approved"],
    scenario.title,
  );
  const piPrompts: string[] = [];
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
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "comment") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "issues") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      piPrompts.push(prompt);
      return scenario.onPi
        ? await scenario.onPi({ call, prompt, config, piPrompts })
        : {
            code: 0,
            stdout: JSON.stringify({
              status: "pr-created",
              prUrl: `https://forgejo.example/pr/${scenario.issueNumber}`,
              branch: `agent/issue-${scenario.issueNumber}-implementation`,
              commits: ["123abc"],
              validation: ["npm test"],
              reviewSummary: "reviewed",
            }),
            stderr: "",
          };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });
  return { config, runner, result, piPrompts, selected };
}

export async function writeBlockedRecoveryRunState(
  config: AgentIssueConfig,
  overrides: Parameters<typeof writeRunState>[1] = {
    issueNumber: 45,
    status: "blocked",
  },
  options: {
    createWorktreePath?: boolean;
    writePlanInPrimaryRepo?: boolean;
    writeSpecInPrimaryRepo?: boolean;
    writePlanInWorktree?: boolean;
    writeSpecInWorktree?: boolean;
  } = {},
): Promise<void> {
  const planPath =
    overrides.planPath ??
    "docs/plans/2026-06-20-issue-45-recover-blocked-run.md";
  const specPath =
    overrides.specPath ??
    "docs/specs/2026-06-20-issue-45-recover-blocked-run.md";
  const worktreePath =
    overrides.worktreePath ??
    ".worktrees/patchmill-issue-45-recover-blocked-run";
  const worktreeRoot = join(config.repoRoot, worktreePath);

  if (options.writePlanInPrimaryRepo !== false) {
    await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  }
  if (options.writeSpecInPrimaryRepo === true) {
    await writeFile(join(config.repoRoot, specPath), "# spec\n", "utf8");
  }

  if (options.createWorktreePath !== false) {
    await mkdir(worktreeRoot, { recursive: true });
  }
  if (options.writePlanInWorktree) {
    await mkdir(join(worktreeRoot, "docs", "plans"), { recursive: true });
    await writeFile(join(worktreeRoot, planPath), "# worktree plan\n", "utf8");
  }
  if (options.writeSpecInWorktree) {
    await mkdir(join(worktreeRoot, "docs", "specs"), { recursive: true });
    await writeFile(join(worktreeRoot, specPath), "# worktree spec\n", "utf8");
  }

  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Recover blocked run",
      status: "blocked",
      specPath,
      specCommit: "spec123",
      planPath,
      planCommit: "plan123",
      branch: "agent/issue-45-recover-blocked-run",
      worktreePath,
      commits: ["abc123", "def456"],
      validation: ["formatting passed", "verification environment unavailable"],
      failureCommentKeys: ["blocked:verification"],
      lastError: "Required verification environment is unavailable.",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        specPathResolved: true,
        planPathResolved: true,
        worktreeReady: true,
      },
      ...overrides,
    },
    NOW.toISOString(),
  );
}

export function blockedRecoveryRunner(
  config: AgentIssueConfig,
  options: {
    selectedLabels?: string[];
    branchExists?: boolean;
    worktreeRegistered?: boolean;
    dirtyStatus?: string;
    merged?: boolean;
    revList?: string;
    log?: string;
    onPi?: (prompt: string) => CommandResult;
    selectedComments?: IssueSummary["comments"];
  } = {},
): MockRunner {
  return createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout:
          page === "1"
            ? issueListPayload([
                {
                  ...issue(
                    45,
                    options.selectedLabels ?? ["needs-info"],
                    "Recover blocked run",
                  ),
                  ...(options.selectedComments
                    ? { comments: options.selectedComments }
                    : {}),
                },
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "show-ref") {
      return {
        code: options.branchExists === false ? 1 : 0,
        stdout: "",
        stderr: "",
      };
    }
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout:
          options.worktreeRegistered === false
            ? ""
            : `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-recover-blocked-run")}\n`,
        stderr: "",
      };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "status"
    ) {
      return { code: 0, stdout: options.dirtyStatus ?? "", stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "branch"
    ) {
      return {
        code: 0,
        stdout: "agent/issue-45-recover-blocked-run\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "merge-base") {
      return { code: options.merged ? 0 : 1, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "rev-list") {
      return { code: 0, stdout: options.revList ?? "0\t2\n", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") {
      return {
        code: 0,
        stdout:
          options.log ?? "def456 add verification\nabc123 implement feature\n",
        stderr: "",
      };
    }
    if (call.command === "tea" && call.args[0] === "logins")
      return {
        code: 0,
        stdout: JSON.stringify([
          { name: "default", user: "patchmill-bot", default: true },
        ]),
        stderr: "",
      };
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      return options.onPi
        ? options.onPi(prompt)
        : {
            code: 0,
            stdout: JSON.stringify({
              status: "pr-created",
              prUrl: "https://forgejo/pr/45",
              branch: "agent/issue-45-recover-blocked-run",
              commits: ["abc123", "def456", "789abc"],
              validation: ["npm test passed"],
              reviewSummary: "reviewed",
            }),
            stderr: "",
          };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
}

export { runStatePath };
