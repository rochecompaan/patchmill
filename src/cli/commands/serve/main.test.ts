import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "./main.ts";
import { createSampleRunDataSource } from "../../../web/sample-data.ts";
for (const signal of ["SIGINT", "SIGTERM"] as const)
  test(`${signal} closes serve and restores signal handlers`, async () => {
    const before = process.listeners(signal);
    const lines: string[] = [];
    let closeCount = 0,
      resolve!: () => void;
    const closed = new Promise<void>((r) => (resolve = r));
    let closing: Promise<void> | undefined;
    const result = main(["--sample"], {
      output: {
        stdout: (l) => {
          lines.push(l);
          queueMicrotask(() => process.emit(signal));
        },
        stderr: assert.fail,
      },
      env: {},
      startServer: async () => ({
        origin: "http://127.0.0.1:4280",
        url: "http://127.0.0.1:4280/?token=test",
        networkExposed: false,
        closed,
        close: () =>
          (closing ??= Promise.resolve().then(() => {
            closeCount++;
            resolve();
          })),
      }),
    });
    assert.equal(await result, 0);
    assert.equal(closeCount, 1);
    assert.match(lines[0]!, /Patchmill sample data:/);
    assert.deepEqual(process.listeners(signal), before);
  });
test("a repeated signal while Web sessions stop keeps serve in charge", async () => {
  const before = process.listeners("SIGINT");
  const out: string[] = [];
  const err: string[] = [];
  const sessions = Promise.withResolvers<void>();
  let closes = 0;
  let closing: Promise<void> | undefined;
  const closed = Promise.withResolvers<void>();
  const result = main([], {
    output: {
      stdout: (l) => {
        out.push(l);
        queueMicrotask(() => process.emit("SIGINT"));
      },
      stderr: (l) => err.push(l),
    },
    env: {},
    createSource: async () => ({
      source: createSampleRunDataSource(),
      sessions: {} as never,
    }),
    startServer: async () => ({
      origin: "http://127.0.0.1:4280",
      url: "http://127.0.0.1:4280/?token=test",
      networkExposed: false,
      closed: closed.promise,
      close: () =>
        (closing ??= (async () => {
          closes++;
          // The HTTP server closes first; the Web sessions take longer.
          closed.resolve();
          await sessions.promise;
        })()),
    }),
  });
  await new Promise((r) => setImmediate(r));
  // While the sessions stop, a second Ctrl-C must not reach Node's default.
  assert.equal(process.listeners("SIGINT").length, before.length + 1);
  process.emit("SIGINT");
  await new Promise((r) => setImmediate(r));
  assert.equal(closes, 1);
  sessions.resolve();
  assert.equal(await result, 0);
  assert.deepEqual(process.listeners("SIGINT"), before);
  assert.match(err.join("\n"), /Stopping the Web sessions/);
  assert.match(err.join("\n"), /Still stopping/);
});
test("serve selects repository data by default and prints the real board prefix", async () => {
  const lines: string[] = [];
  let selected: boolean | undefined;
  const code = await main([], {
    env: {},
    output: { stdout: (s) => lines.push(s), stderr: assert.fail },
    createSource: async (input) => {
      selected = input.sample;
      return { source: createSampleRunDataSource() };
    },
    startServer: async () => ({
      origin: "http://127.0.0.1:4280",
      url: "http://127.0.0.1:4280/?token=test",
      networkExposed: false,
      closed: Promise.resolve(),
      close: async () => {},
    }),
  });
  assert.equal(code, 0);
  assert.equal(selected, false);
  assert.match(lines[0]!, /^Patchmill board:/);
});

test("help and invalid args are effect free and bind failure prints no link", async () => {
  const out: string[] = [],
    err: string[] = [];
  const output = {
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s),
  };
  assert.equal(
    await main(["--help"], {
      output,
      env: { PATCHMILL_SERVE_TOKEN: "" },
      startServer: async () => assert.fail("started"),
    }),
    0,
  );
  assert.equal(
    await main(["--port", "0"], {
      output,
      startServer: async () => assert.fail("started"),
    }),
    1,
  );
  out.length = 0;
  assert.equal(
    await main(["--sample"], {
      output,
      env: {},
      startServer: async () => {
        throw Error("address in use");
      },
    }),
    1,
  );
  assert.deepEqual(out, []);
  assert.match(err.join("\n"), /address in use/);
});
