import type {
  DialogAnswer,
  DialogRequest,
  InteractivePi,
  InteractivePiExit,
} from "../src/kernel/pi-rpc-interactive.ts";
import type { PiHandlers } from "../src/web/session/types.ts";
import type { RpcRecord } from "../src/kernel/pi-rpc-protocol.ts";

export type FakeCommand =
  | { type: "prompt"; text: string }
  | { type: "abort" }
  | { type: "answer"; id: string; answer: DialogAnswer }
  | { type: "end" };

/** An in-memory InteractivePi. With `hold`, prompt and abort wait for
 * `respond()`. */
export function fakeInteractivePi(options: { hold?: boolean } = {}) {
  const ready = Promise.withResolvers<void>();
  const exited = Promise.withResolvers<InteractivePiExit>();
  const commands: FakeCommand[] = [];
  const waiting: { resolve: () => void; reject: (e: Error) => void }[] = [];
  let handlers: PiHandlers | undefined;
  let done = false;
  ready.promise.catch(() => undefined);
  const exit = (e: InteractivePiExit) => {
    if (done) return;
    done = true;
    for (const w of waiting.splice(0)) w.reject(new Error("Pi exited"));
    ready.reject(new Error("Pi exited before it was ready"));
    exited.resolve(e);
  };
  const command = async (record: FakeCommand) => {
    await ready.promise;
    if (done) throw new Error("Pi exited");
    commands.push(record);
    if (!options.hold) return;
    await new Promise<void>((resolve, reject) =>
      waiting.push({ resolve, reject }),
    );
  };
  let ending: Promise<InteractivePiExit> | undefined;
  const pi: InteractivePi = {
    ready: ready.promise,
    prompt: (text) => command({ type: "prompt", text }),
    abort: () => command({ type: "abort" }),
    answer: (id, answer) => {
      commands.push({ type: "answer", id, answer });
    },
    end: () =>
      (ending ??= (async () => {
        commands.push({ type: "end" });
        exit({ exitCode: 0, signal: null, requested: true });
        return exited.promise;
      })()),
    exited: exited.promise,
  };
  return {
    pi,
    commands,
    /** Connect the handlers that a launcher passes to startInteractivePi. */
    connect(next: PiHandlers) {
      handlers = next;
    },
    ready: () => ready.resolve(),
    /** Settle the oldest held command; an error rejects it. */
    respond(error?: string) {
      const w = waiting.shift();
      if (!w) throw new Error("No held command");
      if (error) w.reject(new Error(error));
      else w.resolve();
    },
    held: () => waiting.length,
    emit(record: RpcRecord | Record<string, unknown>) {
      handlers?.onEvent(record as RpcRecord);
    },
    dialog(request: DialogRequest) {
      handlers?.onDialog(request);
    },
    exit,
  };
}
