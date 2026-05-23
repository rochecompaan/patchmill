import { resolve } from "node:path";
import { runTriageAgent } from "../../scripts/agent-issue-triage/agent.ts";
import { runPiPrompt } from "../../scripts/agent-issue/pi.ts";
import { buildImplementationPrompt, buildPlanCreationPrompt } from "../../scripts/agent-issue/prompts.ts";
import type { CommandRunner } from "../../scripts/agent-issue-triage/types.ts";
import type { ImplementationPiInput, PiPromptContracts, PlanPiInput, TriagePiInput } from "./types.ts";

export class PiRunner implements PiPromptContracts {
  private readonly runner: CommandRunner;

  constructor(runner: CommandRunner) {
    this.runner = runner;
  }

  triage(input: TriagePiInput) {
    return runTriageAgent(this.runner, input.repoRoot, input.issues);
  }

  plan(input: PlanPiInput) {
    return runPiPrompt(this.runner, input.repoRoot, buildPlanCreationPrompt(input.issue, input.planPath), {
      ...input.runOptions,
      stage: "pi-plan",
      issueNumber: input.issue.number,
      repoRoot: input.repoRoot,
    });
  }

  implementation(input: ImplementationPiInput) {
    const worktreeRoot = resolve(input.repoRoot, input.worktreePath);

    return runPiPrompt(
      this.runner,
      worktreeRoot,
      buildImplementationPrompt({
        issue: input.issue,
        planPath: input.planPath,
        branch: input.branch,
        worktreePath: input.worktreePath,
        agentTeam: input.agentTeam,
        resume: input.resume,
      }),
      {
        ...input.runOptions,
        stage: "pi-implementation",
        issueNumber: input.issue.number,
        repoRoot: worktreeRoot,
      },
    );
  }
}
