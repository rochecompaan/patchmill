import {
  SubagentsTransport,
  SubagentsRpcError,
} from "./subagents-transport.ts";
export { SubagentsRpcError } from "./subagents-transport.ts";

export const WORKER_AGENT = "patchmill-implementation";
export const REPLY_TIMEOUT_MS = 10_000;
export type EventBus = {
  on(event: string, handler: (data: unknown) => void): (() => void) | void;
  emit(event: string, data: unknown): void;
};
export type WorkerCompletion = {
  id: string;
  state: string;
  timedOut: boolean;
  stopped: boolean;
  output?: string;
  sessionFile?: string;
};
type Waiter = {
  resolve: (value: WorkerCompletion) => void;
  reject: (error: Error) => void;
};
type AsyncId = { details: { asyncId: string } };

export class SubagentsClient {
  private transport: SubagentsTransport;
  private completions = new Map<string, WorkerCompletion>();
  private waiters = new Map<string, Set<Waiter>>();
  private unsubscribe: (() => void) | void;
  private disposed = false;

  constructor(events: EventBus, options?: { replyTimeoutMs?: number }) {
    this.transport = new SubagentsTransport(
      events,
      options?.replyTimeoutMs ?? REPLY_TIMEOUT_MS,
    );
    this.unsubscribe = events.on("subagent:async-complete", (raw) => {
      if (this.disposed) return;
      const data = raw as {
        id?: string;
        runId?: string;
        state: string;
        timedOut?: boolean;
        stopped?: boolean;
        results?: { output?: string; sessionFile?: string }[];
      };
      const id = data.id ?? data.runId;
      if (!id) return;
      const completion: WorkerCompletion = {
        id,
        state: data.state,
        timedOut: data.timedOut === true,
        stopped: data.stopped === true,
        ...(data.results?.[0]?.output !== undefined
          ? { output: data.results[0].output }
          : {}),
        ...(data.results?.[0]?.sessionFile !== undefined
          ? { sessionFile: data.results[0].sessionFile }
          : {}),
      };
      this.completions.set(id, completion);
      for (const waiter of this.waiters.get(id) ?? [])
        waiter.resolve(completion);
    });
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    return this.transport.request<T>(method, params);
  }

  async spawnWorker(input: {
    task: string;
    cwd: string;
    timeoutMs: number;
    output: string;
  }): Promise<string> {
    const data = await this.request<AsyncId>("spawn", {
      agent: WORKER_AGENT,
      task: input.task,
      context: "fork",
      cwd: input.cwd,
      output: input.output,
      maxRuntimeMs: input.timeoutMs,
    });
    return data.details.asyncId;
  }

  waitForCompletion(
    id: string,
    signal?: AbortSignal,
  ): Promise<WorkerCompletion> {
    if (this.disposed)
      return Promise.reject(
        new SubagentsRpcError("disposed", "Client disposed"),
      );
    const buffered = this.completions.get(id);
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve, reject) => {
      const waiters = this.waiters.get(id) ?? new Set<Waiter>();
      this.waiters.set(id, waiters);
      const cleanup = () => {
        signal?.removeEventListener("abort", abort);
        waiters.delete(waiter);
        if (waiters.size === 0) this.waiters.delete(id);
      };
      const waiter: Waiter = {
        resolve: (completion) => {
          cleanup();
          resolve(completion);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      const abort = () => {
        void this.stop(id).catch(waiter.reject);
      };
      waiters.add(waiter);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  async resume(id: string, message: string): Promise<string> {
    const data = await this.request<AsyncId>("resume", { id, message });
    return data.details.asyncId;
  }

  async stop(id: string): Promise<void> {
    await this.request("stop", { id });
  }

  async activeWorkers(): Promise<{ id: string; state: string }[]> {
    const data = await this.request<{
      asyncSnapshot: {
        runs: { id: string; state: string; children?: { agent?: string }[] }[];
      };
    }>("status");
    return data.asyncSnapshot.runs
      .filter(
        (run) =>
          ["running", "queued", "stopping"].includes(run.state) &&
          run.children?.some((step) => step.agent === WORKER_AGENT),
      )
      .map(({ id, state }) => ({ id, state }));
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.transport.dispose();
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters)
        waiter.reject(new SubagentsRpcError("disposed", "Client disposed"));
    }
    this.completions.clear();
  }
}
