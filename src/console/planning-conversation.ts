import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PhaseLaunch, PhaseRun } from "../kernel/launch.ts";
import type { AgentResult } from "../kernel/result.ts";
import { recordPlanningUsage, type ConsoleSession } from "./planning-usage.ts";

export class PlanningConversation {
  private pending: ((run: PhaseRun) => void) | undefined;
  gate: PhaseLaunch["planningGate"];
  private pi: Pick<ExtensionAPI, "sendUserMessage">;
  private session: ConsoleSession | undefined;
  constructor(
    pi: Pick<ExtensionAPI, "sendUserMessage">,
    session?: ConsoleSession,
  ) {
    this.pi = pi;
    this.session = session;
  }

  run(
    launch: PhaseLaunch,
    feedback?: string,
    aborted?: PhaseRun,
  ): Promise<PhaseRun> {
    this.gate = launch.planningGate;
    return recordPlanningUsage(this.session, launch.sessionDir, () =>
      aborted
        ? Promise.resolve(aborted)
        : new Promise((resolve) => {
            this.pending = resolve;
            const reason =
              this.gate?.required && !this.gate.pullRequest
                ? "\n\nThis gate offers chat approval only: a planning PR would carry the earlier unmerged document. Keep later documents on the implementation branch."
                : "";
            this.pi.sendUserMessage(
              (feedback === undefined
                ? launch.envelope
                : `Patchmill could not accept the planning result:\n\n${feedback}\n\nFix it and submit again.`) +
                reason,
              { deliverAs: "followUp" },
            );
          }),
    );
  }

  submit(
    result: AgentResult,
    planningApproval?: PhaseRun["planningApproval"],
  ): string {
    if (!this.pending) return "Patchmill is not waiting for a planning result.";
    const resolve = this.pending;
    this.pending = undefined;
    this.gate = undefined;
    resolve({
      result: { ok: true, result },
      session: { exitCode: 0, timedOut: false, aborted: false },
      ...(planningApproval ? { planningApproval } : {}),
    });
    return "Planning result submitted.";
  }

  close(aborted: PhaseRun) {
    this.pending?.(aborted);
    this.pending = undefined;
    this.gate = undefined;
  }
}
