import { resolve } from "node:path";
import { DEFAULT_PATCHMILL_POLICY } from "../policy/defaults.ts";
import { runPiPrompt } from "../cli/commands/run-once/pi.ts";
import {
  buildImplementationPrompt,
  buildPlanCreationPrompt,
} from "../cli/commands/run-once/prompts.ts";
import type { CommandRunner } from "../cli/commands/triage/types.ts";
import type { PatchmillProjectPolicy } from "../policy/types.ts";
import type {
  ImplementationPiInput,
  PiPromptContracts,
  PlanPiInput,
} from "./types.ts";
import { DEFAULT_PATCHMILL_SKILLS } from "../workflow/skills.ts";
import {
  profileExtensionArgs,
  runOnceImplementationPiProfile,
  runOncePlanningPiProfile,
} from "./resource-profiles.ts";

function defaultImplementationPolicy(
  baseBranch: string,
): PatchmillProjectPolicy {
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

  plan(input: PlanPiInput) {
    const projectPolicy = input.projectPolicy ?? DEFAULT_PATCHMILL_POLICY;
    const profile = runOncePlanningPiProfile(
      input.skills ?? DEFAULT_PATCHMILL_SKILLS,
      input.repoRoot,
    );

    return runPiPrompt(
      this.runner,
      input.repoRoot,
      buildPlanCreationPrompt({
        issue: input.issue,
        planPath: input.planPath,
        projectPolicy,
        planApprovalRequired: input.planApprovalRequired,
        skills: input.skills,
        triageLabels: input.triageLabels,
      }),
      {
        ...input.runOptions,
        stage: "pi-plan",
        skillPaths: profile.additionalSkillPaths,
        extensionArgs: profileExtensionArgs(profile),
        issueNumber: input.issue.number,
        repoRoot: input.repoRoot,
        taskContract: projectPolicy.pi.taskContract,
      },
    );
  }

  implementation(input: ImplementationPiInput) {
    const worktreeRoot = resolve(input.repoRoot, input.worktreePath);
    const projectPolicy =
      input.projectPolicy ?? defaultImplementationPolicy(input.git.baseBranch);
    const profile = runOnceImplementationPiProfile(
      input.skills ?? DEFAULT_PATCHMILL_SKILLS,
      input.repoRoot,
    );

    return runPiPrompt(
      this.runner,
      worktreeRoot,
      buildImplementationPrompt({
        issue: input.issue,
        planPath: input.planPath,
        branch: input.branch,
        worktreePath: input.worktreePath,
        git: input.git,
        projectPolicy,
        skills: input.skills,
        resume: input.resume,
      }),
      {
        ...input.runOptions,
        stage: "pi-implementation",
        skillPaths: profile.additionalSkillPaths,
        extensionArgs: profileExtensionArgs(profile),
        issueNumber: input.issue.number,
        repoRoot: worktreeRoot,
        taskContract: projectPolicy.pi.taskContract,
      },
    );
  }
}
