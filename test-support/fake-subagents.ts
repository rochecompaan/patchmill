import type { EventBus } from "../src/console/subagents-client.ts";

export type RpcRequest = {
  version: number;
  requestId: string;
  method: string;
  params?: any;
  source: { extension: string };
};
export type Script = (request: RpcRequest) => unknown;
export const NO_REPLY = Symbol("no reply");

export function fakeSubagents(scripts: Record<string, Script> = {}) {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const requests: RpcRequest[] = [];
  let nextId = 0;
  const bus: EventBus = {
    on(event, handler) {
      const listeners = handlers.get(event) ?? new Set();
      handlers.set(event, listeners);
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    emit(event, data) {
      for (const handler of handlers.get(event) ?? []) handler(data);
      if (event !== "subagents:rpc:v1:request") return;
      const request = data as RpcRequest;
      requests.push(request);
      const defaults: Record<string, Script> = {
        ping: () => ({ version: 1 }),
        spawn: () => ({ details: { asyncId: `run-${++nextId}` } }),
        resume: () => ({ details: { asyncId: `run-${++nextId}` } }),
        status: () => ({ asyncSnapshot: { runs: [] } }),
        stop: () => ({ runId: request.params.id, state: "stopping" }),
      };
      const reply = (scripts[request.method] ?? defaults[request.method])?.(
        request,
      );
      if (reply === NO_REPLY) return;
      bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
        version: 1,
        requestId: request.requestId,
        method: request.method,
        ...(reply && typeof reply === "object" && "error" in reply
          ? { success: false, ...reply }
          : { success: true, data: reply }),
      });
    },
  };
  return {
    ...bus,
    requests,
    complete(id: string, payload: Record<string, unknown> = {}) {
      bus.emit("subagent:async-complete", {
        id,
        runId: id,
        state: "complete",
        ...payload,
      });
    },
    listenerCount() {
      return [...handlers.values()].reduce(
        (sum, listeners) => sum + listeners.size,
        0,
      );
    },
  };
}
