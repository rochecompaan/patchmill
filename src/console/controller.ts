import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  HumanChannel,
  Wait,
  BlockAnswer,
} from "../kernel/human-channel.ts";
import type { PhaseLaunch, PhaseRun } from "../kernel/launch.ts";
import type { AgentResult } from "../kernel/result.ts";
import type { RunSnapshot } from "../kernel/run-snapshot.ts";
import type { RunOnceOutcome } from "../kernel/run-once.ts";
import { costLine } from "../kernel/pi-cost.ts";
import type { WorkerLauncher } from "./worker-launcher.ts";

export type StartRun = (
  issue: number,
  channel: HumanChannel,
  observe: (s: RunSnapshot) => void,
) => Promise<RunOnceOutcome>;
export type ConsoleStatus = {
  snapshot?: RunSnapshot;
  worker?: { id: string; state: string };
  waiting?: Wait;
  estimatedCost?: string;
};
type Dependencies = {
  pi: Pick<ExtensionAPI, "sendUserMessage" | "sendMessage">;
  workers: WorkerLauncher;
  startRun: StartRun;
};
const aborted: PhaseRun = {
  result: { ok: false, reason: "Console shut down." },
  session: { exitCode: null, timedOut: false, aborted: true },
};

/** Owns the chat-side rendezvous points for one Issue run. */
export class ConsoleController implements HumanChannel {
  private deps: Dependencies;
  private active: Promise<void> | undefined;
  private snapshot: RunSnapshot | undefined;
  private planning: ((run: PhaseRun) => void) | undefined;
  private waiting: Wait | undefined;
  private continuation: ((answer: "continue" | "quit") => void) | undefined;
  private guidance: ((answer: BlockAnswer) => void) | undefined;
  private next: ((message: string) => void) | undefined;
  private closing = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(deps: Dependencies) {
    this.deps = deps;
  }

  async startIssueRun(issue: number): Promise<string> {
    if (this.active) throw new Error("An Issue run is already active.");
    if (this.closing) return "The console is shutting down.";
    this.snapshot = undefined;
    this.active = Promise.resolve()
      .then(() =>
        this.deps.startRun(issue, this, (snapshot) => {
          this.snapshot = snapshot;
          if (
            snapshot.state === "planning" ||
            snapshot.state === "implementation"
          )
            this.reportNext(
              `The Issue run continues with ${snapshot.phase ?? snapshot.state}.`,
            );
        }),
      )
      .then(
        (outcome) => {
          this.reportNext(
            this.snapshot?.summary ??
              ("summary" in outcome
                ? outcome.summary
                : "reason" in outcome
                  ? outcome.reason
                  : `Issue run ${outcome.status}.`),
          );
        },
        (error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          this.notify(message);
          this.reportNext(message);
        },
      )
      .finally(() => {
        this.active = undefined;
      });
    return `Started Issue run #${issue}.`;
  }

  runPlanning(launch: PhaseLaunch, feedback?: string): Promise<PhaseRun> {
    if (this.closing) return Promise.resolve(aborted);
    return new Promise((resolve) => {
      this.planning = resolve;
      this.deps.pi.sendUserMessage(
        feedback === undefined
          ? launch.envelope
          : `Patchmill could not accept the planning result:\n\n${feedback}\n\nFix it and submit again.`,
        { deliverAs: "followUp" },
      );
    });
  }

  async submitPlanning(result: AgentResult): Promise<string> {
    if (!this.planning)
      return "Patchmill is not waiting for a planning result.";
    const resolve = this.planning;
    this.planning = undefined;
    resolve({
      result: { ok: true, result },
      session: { exitCode: 0, timedOut: false, aborted: false },
    });
    return "Planning result submitted.";
  }

  runImplementation(launch: PhaseLaunch): Promise<PhaseRun> {
    return this.closing
      ? Promise.resolve(aborted)
      : this.deps.workers.run(launch);
  }

  resumeImplementation(
    launch: PhaseLaunch,
    guidance: string,
  ): Promise<PhaseRun> {
    return this.closing
      ? Promise.resolve(aborted)
      : this.deps.workers.resume(launch, guidance);
  }

  awaitContinue(wait: Wait): Promise<"continue" | "quit"> {
    if (this.closing) return Promise.resolve("quit");
    return new Promise((resolve) => {
      this.waiting = wait;
      this.continuation = resolve;
      this.deps.pi.sendMessage(
        { customType: "patchmill", content: wait.message, display: true },
        { triggerTurn: true },
      );
      this.reportNext(wait.message);
    });
  }

  async continueRun(): Promise<string> {
    if (!this.continuation) return "No Issue run is waiting for a merge.";
    const resolve = this.continuation;
    this.continuation = undefined;
    this.waiting = undefined;
    const next = new Promise<string>((resolveNext) => {
      this.next = resolveNext;
    });
    resolve("continue");
    return next;
  }

  awaitGuidance(_summary: string): Promise<BlockAnswer> {
    if (this.closing) return Promise.resolve({ kind: "quit" });
    return new Promise((resolve) => {
      this.guidance = resolve;
    });
  }

  async confirmGuidance(_text: string): Promise<string> {
    return "No worker is blocked.";
  }

  notify(text: string): void {
    this.deps.pi.sendMessage(
      { customType: "patchmill", content: text, display: true },
      { triggerTurn: false },
    );
  }

  status(): ConsoleStatus {
    const worker = this.deps.workers.active();
    return {
      ...(this.snapshot ? { snapshot: this.snapshot } : {}),
      ...(worker ? { worker } : {}),
      ...(this.waiting ? { waiting: this.waiting } : {}),
      ...(this.snapshot?.usage
        ? { estimatedCost: costLine(this.snapshot.usage) }
        : {}),
    };
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.close();
    return this.shutdownPromise;
  }

  private async close(): Promise<void> {
    this.closing = true;
    this.planning?.(aborted);
    this.planning = undefined;
    this.continuation?.("quit");
    this.continuation = undefined;
    this.waiting = undefined;
    this.guidance?.({ kind: "quit" });
    this.guidance = undefined;
    try {
      await this.deps.workers.stopActive();
    } finally {
      await this.active;
    }
  }

  private reportNext(message: string) {
    const resolve = this.next;
    this.next = undefined;
    resolve?.(message);
  }
}
