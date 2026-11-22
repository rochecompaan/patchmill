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
import type { ConsoleSession } from "./planning-usage.ts";
import { collectPlanningDialogFacts } from "./planning-dialog-facts.ts";
import { PlanningConversation } from "./planning-conversation.ts";
import { progressLabel, type RunStatus } from "./run-status.ts";
import {
  describeRunEnd,
  summaryOf,
  type EndedRun,
  type RunEndInput,
} from "./run-end.ts";

export type StartRun = (
  issue: number | undefined,
  channel: HumanChannel,
  observe: (s: RunSnapshot) => void,
) => Promise<RunOnceOutcome>;
export type ConsoleStatus = {
  snapshot?: RunSnapshot;
  worker?: { id: string; state: string };
  waiting?: Wait;
  estimatedCost?: string;
  ended?: EndedRun;
};
type Dependencies = {
  pi: Pick<ExtensionAPI, "sendUserMessage" | "sendMessage">;
  session?: ConsoleSession;
  workers: WorkerLauncher;
  startRun: StartRun;
  runStatus?: Pick<RunStatus, "show" | "clear">;
  /** Post the end-of-run message. The Web session posts its own closing line. */
  announceRunEnd?: boolean;
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
  private ended: EndedRun | undefined;
  private planning: PlanningConversation;
  private waiting: Wait | undefined;
  private continuation: ((answer: "continue" | "quit") => void) | undefined;
  private guidance: ((answer: BlockAnswer) => void) | undefined;
  private next: ((message: string) => void) | undefined;
  private closing = false;
  private shutdownPromise: Promise<void> | undefined;
  constructor(deps: Dependencies) {
    this.deps = deps;
    this.planning = new PlanningConversation(deps.pi, deps.session);
  }
  startRefusal(): string | undefined {
    if (this.closing) return "The console is shutting down.";
    if (this.active) return "An Issue run is already active.";
    return undefined;
  }
  async startIssueRun(issue?: number): Promise<string> {
    const refusal = this.startRefusal();
    if (refusal) throw new Error(refusal);
    this.snapshot = undefined;
    this.ended = undefined;
    if (issue !== undefined)
      this.deps.runStatus?.show({ issue, label: "preparing" });
    this.active = Promise.resolve()
      .then(() =>
        this.deps.startRun(issue, this, (snapshot) => {
          // Shutdown already cleared the status; a late snapshot shows nothing.
          if (this.closing) return;
          this.snapshot = snapshot;
          this.deps.runStatus?.show({
            issue: snapshot.issue,
            ...(snapshot.title === undefined ? {} : { title: snapshot.title }),
            label: progressLabel(snapshot),
          });
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
        (outcome) => this.settle(issue, { outcome }),
        (error: unknown) =>
          this.settle(issue, {
            error: error instanceof Error ? error.message : String(error),
          }),
      )
      .finally(() => {
        this.active = undefined;
      });
    return issue === undefined
      ? "Started the next Issue run."
      : `Started Issue run #${issue}.`;
  }

  /** Keep the ended run on screen until shutdown; never rejects `active`. */
  private settle(issue: number | undefined, settled: RunEndInput["settled"]) {
    if (this.closing) return;
    let reply = summaryOf({
      ...(this.snapshot ? { snapshot: this.snapshot } : {}),
      settled,
    });
    try {
      const ended = describeRunEnd({
        ...(issue === undefined ? {} : { issue }),
        ...(this.snapshot ? { snapshot: this.snapshot } : {}),
        settled,
      });
      if (!ended) {
        if ("error" in settled) this.notify(settled.error);
        return;
      }
      this.ended = ended;
      this.deps.runStatus?.show(ended);
      if (this.deps.announceRunEnd === false) {
        reply = ended.summary;
        if ("error" in settled) this.notify(settled.error);
        return;
      }
      reply = ended.message;
      this.deps.pi.sendMessage(
        { customType: "patchmill", content: ended.message, display: true },
        { triggerTurn: ended.explain },
      );
    } catch {
      /* Display only. The Pi context may already be closed. */
    } finally {
      this.reportNext(reply);
    }
  }

  runPlanning(launch: PhaseLaunch, feedback?: string): Promise<PhaseRun> {
    return this.planning.run(
      launch,
      feedback,
      this.closing ? aborted : undefined,
    );
  }

  async planningDialogFacts() {
    return this.planning.launch
      ? collectPlanningDialogFacts(this.planning.launch)
      : undefined;
  }

  planningGate() {
    return this.planning.gate;
  }

  async submitPlanning(
    result: AgentResult,
    approval?: PhaseRun["planningApproval"],
  ): Promise<string> {
    return this.planning.submit(result, approval);
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

  awaitGuidance(summary: string): Promise<BlockAnswer> {
    if (this.closing) return Promise.resolve({ kind: "quit" });
    return new Promise((resolve) => {
      this.guidance = resolve;
      this.deps.pi.sendMessage(
        { customType: "patchmill", content: summary, display: true },
        { triggerTurn: true },
      );
      this.reportNext(summary);
    });
  }

  async confirmGuidance(text: string): Promise<string> {
    if (!this.guidance) return "No worker is blocked.";
    const resolve = this.guidance;
    this.guidance = undefined;
    resolve({ kind: "guidance", text });
    return "Guidance submitted.";
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
      ...(this.ended ? { ended: this.ended } : {}),
    };
  }
  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.close();
    return this.shutdownPromise;
  }
  private async close(): Promise<void> {
    this.deps.runStatus?.clear();
    this.closing = true;
    this.planning.close(aborted);
    this.continuation?.("quit");
    this.continuation = undefined;
    this.waiting = undefined;
    this.guidance?.({ kind: "quit" });
    this.guidance = undefined;
    this.reportNext("The console is shutting down.");
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
