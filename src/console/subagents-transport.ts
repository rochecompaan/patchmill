import { randomUUID } from "node:crypto";
import type { EventBus } from "./subagents-client.ts";

export class SubagentsRpcError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SubagentsRpcError";
    this.code = code;
  }
}

export class SubagentsTransport {
  private pending = new Set<(error: Error) => void>();
  private readiness: Promise<unknown> | undefined;
  private disposed = false;
  private events: EventBus;
  private timeoutMs: number;
  constructor(events: EventBus, timeoutMs: number) {
    this.events = events;
    this.timeoutMs = timeoutMs;
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    if (this.disposed)
      throw new SubagentsRpcError("disposed", "Client disposed");
    this.readiness ??= this.exchange("ping", undefined, true);
    await this.readiness;
    return this.exchange(method, params) as Promise<T>;
  }

  private exchange(
    method: string,
    params?: unknown,
    retry = false,
  ): Promise<unknown> {
    if (this.disposed)
      return Promise.reject(
        new SubagentsRpcError("disposed", "Client disposed"),
      );
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      let interval: ReturnType<typeof setInterval> | undefined;
      const finish = (error?: Error, data?: unknown) => {
        clearTimeout(timer);
        clearInterval(interval);
        unsubscribe?.();
        this.pending.delete(cancel);
        if (error) reject(error);
        else resolve(data);
      };
      const cancel = (error: Error) => finish(error);
      const timer = setTimeout(
        () =>
          finish(
            new SubagentsRpcError(
              "reply_timeout",
              `pi-subagents did not reply to ${method}`,
            ),
          ),
        this.timeoutMs,
      );
      this.pending.add(cancel);
      const unsubscribe = this.events.on(
        `subagents:rpc:v1:reply:${requestId}`,
        (raw) => {
          const reply = raw as {
            success: boolean;
            data?: unknown;
            error?: { code: string; message: string };
          };
          if (reply.success) finish(undefined, reply.data);
          else
            finish(
              new SubagentsRpcError(
                reply.error?.code ?? "execution_failed",
                reply.error?.message ?? "RPC failed",
              ),
            );
        },
      );
      const send = () => {
        try {
          this.events.emit("subagents:rpc:v1:request", {
            version: 1,
            requestId,
            method,
            params,
            source: { extension: "patchmill" },
          });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      };
      if (retry) interval = setInterval(send, 250);
      send();
    });
  }

  dispose() {
    this.disposed = true;
    for (const cancel of this.pending)
      cancel(new SubagentsRpcError("disposed", "Client disposed"));
  }
}
