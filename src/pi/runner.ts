import { resolve } from "node:path";
import { DEFAULT_PATCHMILL_POLICY } from "../policy/defaults.ts";
import { runTriageAgent } from "../../scripts/agent-issue-triage/agent.ts";
import { runPiPrompt } from "../../scripts/agent-issue/pi.ts";
import { buildImplementationPrompt, buildPlanCreationPrompt } from "../../scripts/agent-issue/prompts.ts";
import type { CommandRunner } from "../../scripts/agent-issue-triage/types.ts";
import type { PatchmillProjectPolicy } from "../policy/types.ts";
import type { ImplementationPiInput, PiPromptContracts, PlanPiInput, TriagePiInput } from "./types.ts";

function defaultImplementationPolicy(baseBranch: string): PatchmillProjectPolicy {
  return {
    ...DEFAULT_PATCHMILL_POLICY,
    directLand: {
      ...DEFAULT_PATCHMILL_POLICY.directLand,
      targetBranch: baseBranch,
    },
  };
}

export class PiRunner implements PiPromptContracts {
  private readonly runner: CommandRunner;

  constructor(runner: CommandRunner) {
    this.runner = runner;
  }

  triage(input: TriagePiInput) {
    return runTriageAgent(this.runner, input.repoRoot, {
      issues: input.issues,
      projectPolicy: input.projectPolicy ?? DEFAULT_PATCHMILL_POLICY,
    });
  }

  plan(input: PlanPiInput) {
    const projectPolicy = input.projectPolicy ?? DEFAULT_PATCHMILL_POLICY;
    return runPiPrompt(this.runner, input.repoRoot, buildPlanCreationPrompt({
      issue: input.issue,
      planPath: input.planPath,
      projectPolicy,
    }), {
      ...input.runOptions,
      stage: "pi-plan",
      issueNumber: input.issue.number,
      repoRoot: input.repoRoot,
      taskContract: projectPolicy.pi.taskContract,
    });
  }

  implementation(input: ImplementationPiInput) {
    const worktreeRoot = resolve(input.repoRoot, input.worktreePath);
    const projectPolicy = input.projectPolicy ?? defaultImplementationPolicy(input.git.baseBranch);

    return runPiPrompt(
      this.runner,
      worktreeRoot,
      buildImplementationPrompt({
        issue: input.issue,
        planPath: input.planPath,
        branch: input.branch,
        worktreePath: input.worktreePath,
        agentTeam: input.agentTeam,
        git: input.git,
        projectPolicy,
        resume: input.resume,
      }),
      {
        ...input.runOptions,
        stage: "pi-implementation",
        issueNumber: input.issue.number,
        repoRoot: worktreeRoot,
        taskContract: projectPolicy.pi.taskContract,
      },
    );
  }
}
