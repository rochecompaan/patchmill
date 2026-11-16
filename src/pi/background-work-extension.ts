import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { stopWorkers } from "../console/stray-workers.ts";
import { SubagentsClient } from "../console/subagents-client.ts";
import { BACKGROUND_WORK_STATUS } from "../kernel/pi-rpc-protocol.ts";

/**
 * pi-subagents publishes whether a session still owes background work through
 * this host registry. With `ctx.hasUI`, it does not drain that work before the
 * agent settles, so a Pi RPC client needs this check to finish at the same
 * point as print mode.
 */
export const LIVENESS_REGISTRY_KEY = Symbol.for(
  "@agegr/pi-web/session-liveness/v1",
);

type Registration = {
  name: string;
  sessionId: string;
  sessionFile?: string;
  isActive: () => boolean;
};
type Registry = { version: 1; register: (r: Registration) => unknown };
export type BackgroundWorkOptions = {
  pollMs?: number;
  stopBudgetMs?: number;
  replyTimeoutMs?: number;
};

function installRegistry(registrations: Set<Registration>): void {
  const slot = globalThis as Record<symbol, unknown>;
  const existing = slot[LIVENESS_REGISTRY_KEY] as Registry | undefined;
  const keep = (registration: Registration, release?: () => void) => {
    registrations.add(registration);
    return () => {
      registrations.delete(registration);
      release?.();
    };
  };
  if (existing === undefined) {
    slot[LIVENESS_REGISTRY_KEY] = {
      version: 1,
      register: (registration: Registration) => keep(registration),
    } satisfies Registry;
    return;
  }
  if (
    typeof existing !== "object" ||
    existing === null ||
    existing.version !== 1 ||
    typeof existing.register !== "function"
  )
    return;
  const original = existing.register.bind(existing);
  existing.register = (registration) => {
    const release = original(registration);
    if (typeof release !== "function") return release;
    return keep(registration, release as () => void);
  };
}

export function createBackgroundWorkExtension(
  options: BackgroundWorkOptions = {},
) {
  const pollMs = options.pollMs ?? 1_000;
  const stopBudgetMs = options.stopBudgetMs ?? 3_000;
  return (pi: ExtensionAPI): void => {
    const registrations = new Set<Registration>();
    installRegistry(registrations);
    let settles = 0;
    // Pi makes ctx stale after shutdown; a late settle must not touch it.
    let shutDown = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const stopPolling = () => {
      clearInterval(poll);
      poll = undefined;
    };
    const count = (ctx: ExtensionContext): 0 | 1 => {
      const sessionId = ctx.sessionManager.getSessionId();
      for (const registration of registrations) {
        if (registration.sessionId !== sessionId) continue;
        try {
          if (registration.isActive()) return 1;
        } catch (error) {
          console.error(
            `Background-work check of ${registration.name} failed:`,
            error,
          );
        }
      }
      return 0;
    };
    const report = (ctx: ExtensionContext, settle: number, work: 0 | 1) => {
      try {
        ctx.ui.setStatus(BACKGROUND_WORK_STATUS, `${settle}:${work}`);
      } catch (error) {
        console.error("Background-work report failed:", error);
      }
    };

    pi.on("agent_start", () => stopPolling());
    pi.on("agent_settled", (_event, ctx) => {
      stopPolling();
      if (shutDown) return;
      const settle = ++settles;
      const work = count(ctx);
      report(ctx, settle, work);
      if (work === 0) return;
      // Work can end with no new turn, for example a retained nested route.
      poll = setInterval(() => {
        if (settle !== settles || count(ctx) === 1) return;
        stopPolling();
        report(ctx, settle, 0);
      }, pollMs);
      poll.unref?.();
    });
    pi.on("session_shutdown", async (_event, ctx) => {
      shutDown = true;
      stopPolling();
      if (count(ctx) === 0) return;
      // Async runners are detached from Pi's process group; stop them here,
      // before pi-subagents removes its RPC bridge. A stop reply is only a
      // receipt, so wait until status no longer lists the runs.
      const client = new SubagentsClient(pi.events, {
        replyTimeoutMs: options.replyTimeoutMs ?? stopBudgetMs,
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stopping = stopWorkers(client, {
        scope: "runs",
        // Leave room to name the stuck runs before the hard budget below,
        // which only applies when pi-subagents stops answering.
        waitMs: Math.max(0, stopBudgetMs - 250),
        pollMs: Math.min(pollMs, 100),
      });
      // When the budget wins, the disposed client rejects the rest quietly.
      stopping.catch(() => undefined);
      try {
        const outcome = await Promise.race([
          stopping,
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), stopBudgetMs);
          }),
        ]);
        if (!outcome)
          console.error(
            `Background work was not proven stopped within ${stopBudgetMs}ms.`,
          );
        else if (!outcome.ok)
          console.error(
            `Background runs still active after shutdown: ${outcome.stuck.join(", ")}`,
          );
      } catch (error) {
        console.error("Stopping background work failed:", error);
      } finally {
        clearTimeout(timer);
        client.dispose();
      }
    });
  };
}

export default createBackgroundWorkExtension();
