import { resolve } from "node:path";
import type {
  HumanChannel,
  Wait,
  BlockAnswer,
} from "../src/kernel/human-channel.ts";
import { printModeLauncher } from "../src/kernel/launch.ts";
import type { Scenario } from "./run-once-fixture.ts";

export function fakeHuman(
  c: Scenario,
  script: {
    onWait?: (wait: Wait, count: number) => Promise<"continue" | "quit">;
    onGuidance?: (summary: string) => Promise<BlockAnswer>;
    quitPlanningAt?: number;
  } = {},
): HumanChannel & { calls: string[]; feedback: string[] } {
  const calls: string[] = [];
  const feedback: string[] = [];
  let planningCount = 0;
  let waitCount = 0;
  const launch = printModeLauncher({
    command: c.deps.piCommand,
    agentDir: resolve(c.repoRoot, c.config.pi.agentDir),
    extensionPaths: c.deps.extensionPaths,
  });
  return {
    calls,
    feedback,
    async runPlanning(request, reason) {
      calls.push("planning");
      if (reason !== undefined) feedback.push(reason);
      if (++planningCount === script.quitPlanningAt)
        return {
          session: { exitCode: null, timedOut: false, aborted: true },
          result: { ok: false, reason: "Planning quit" },
        };
      return launch(request);
    },
    runImplementation(request) {
      calls.push("implementation");
      return launch(request);
    },
    resumeImplementation(request, guidance) {
      calls.push(`resume:${guidance}`);
      return launch(request);
    },
    async awaitContinue(wait) {
      calls.push(`wait:${wait.kind}`);
      return script.onWait?.(wait, ++waitCount) ?? "quit";
    },
    async awaitGuidance(summary) {
      calls.push("guidance");
      return script.onGuidance?.(summary) ?? { kind: "quit" };
    },
    notify(text) {
      calls.push(`notify:${text}`);
    },
  };
}
