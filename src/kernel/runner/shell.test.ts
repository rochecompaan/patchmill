import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffDelay, type RunBackoffConfig } from "./backoff.ts";
import {
  runRunnerShell,
  type PassResult,
  type RunnerShellInput,
  type TriageGrant,
} from "./shell.ts";

type Step = PassResult | { throw: string } | (() => Promise<PassResult>);

const worked: PassResult = { kind: "worked" };
const idle: PassResult = { kind: "idle", reason: "no eligible issue" };
const fail = (message = "host down"): Step => ({ throw: message });

function harness(
  script: Step[],
  options: {
    grants?: number[];
    triage?: (grant: TriageGrant, signal: AbortSignal) => Promise<void>;
    backoff?: RunBackoffConfig;
    sleep?: RunnerShellInput["sleep"];
  } = {},
) {
  const controller = new AbortController();
  const calls: string[] = [];
  const sleeps: number[] = [];
  const log: string[] = [];
  const grants: TriageGrant[] = [];
  let passes = 0;
  let gateCalls = 0;
  let releases = 0;
  const input: RunnerShellInput = {
    signal: controller.signal,
    backoff: options.backoff ?? {
      idle: { initialSeconds: 10, maxSeconds: 60 },
      error: { initialSeconds: 5, maxSeconds: 100 },
    },
    random: () => 0.5,
    log: (line) => log.push(line),
    sleep:
      options.sleep ??
      (async (ms) => {
        sleeps.push(ms);
      }),
    workSource: {
      async pass() {
        calls.push("pass");
        const step = script[passes++];
        if (step === undefined) {
          controller.abort();
          return idle;
        }
        if (typeof step === "function") return step();
        if ("throw" in step) throw new Error(step.throw);
        return step;
      },
    },
    triageGate: {
      async tryGrant() {
        calls.push("tryGrant");
        gateCalls += 1;
        if (!(options.grants ?? []).includes(gateCalls)) return undefined;
        const grant: TriageGrant = {
          async release() {
            calls.push("release");
            releases += 1;
          },
        };
        grants.push(grant);
        return grant;
      },
    },
    async triage(grant, signal) {
      calls.push("triage");
      await options.triage?.(grant, signal);
    },
  };
  return {
    controller,
    input,
    calls,
    sleeps,
    log,
    grants,
    passes: () => passes,
    releases: () => releases,
    run: () => runRunnerShell(input),
  };
}

test("backoffDelay doubles, jitters, and caps", () => {
  const delay = { initialSeconds: 10, maxSeconds: 60 };
  assert.equal(backoffDelay(delay, 1, 0), 5000);
  assert.ok(backoffDelay(delay, 1, 0.9999) < 10000);
  assert.equal(backoffDelay(delay, 3, 0.5), 30000);
  assert.equal(backoffDelay(delay, 10, 0.5), 45000);
});

test("worked runs the next pass without a wait", async () => {
  const h = harness([worked, worked]);
  assert.deepEqual(await h.run(), { kind: "stopped" });
  assert.deepEqual(h.sleeps, []);
  assert.equal(h.passes(), 3);
});

test("idle backs off with a growing idle delay", async () => {
  const h = harness([idle, idle, idle]);
  assert.deepEqual(await h.run(), { kind: "stopped" });
  assert.deepEqual(h.sleeps, [7500, 15000, 30000]);
  assert.match(h.log.join("\n"), /no eligible issue/);
});

test("a throw backs off with the error delay", async () => {
  const h = harness([fail(), fail()]);
  assert.deepEqual(await h.run(), { kind: "stopped" });
  assert.deepEqual(h.sleeps, [3750, 7500]);
  assert.match(h.log.join("\n"), /host down/);
});

test("worked resets both streaks", async () => {
  const a = harness([idle, idle, worked, idle]);
  await a.run();
  assert.deepEqual(a.sleeps, [7500, 15000, 7500]);
  const b = harness([fail(), fail(), worked, fail()]);
  await b.run();
  assert.deepEqual(b.sleeps, [3750, 7500, 3750]);
});

test("idle resets the error streak and a throw resets the idle streak", async () => {
  const h = harness([fail(), fail(), idle, fail()]);
  await h.run();
  assert.deepEqual(h.sleeps, [3750, 7500, 7500, 3750]);
  const g = harness([idle, idle, fail(), idle]);
  await g.run();
  assert.deepEqual(g.sleeps, [7500, 15000, 3750, 7500]);
});

test("fatal returns at once", async () => {
  const h = harness([{ kind: "fatal", reason: "conflict" }, worked]);
  assert.deepEqual(await h.run(), { kind: "fatal", reason: "conflict" });
  assert.equal(h.passes(), 1);
});

test("triage runs before the pass when the gate grants, and its grant is released", async () => {
  const h = harness([worked], { grants: [1] });
  await h.run();
  assert.deepEqual(h.calls, [
    "tryGrant",
    "triage",
    "release",
    "pass",
    "tryGrant",
    "pass",
  ]);
});

test("the grant's beforeWrite reaches triage", async () => {
  let received: TriageGrant | undefined;
  const h = harness([], {
    grants: [1],
    triage: async (grant) => {
      received = grant;
    },
  });
  await h.run();
  assert.equal(received, h.grants[0]);
});

test("a triage throw is logged and the pass still runs", async () => {
  const h = harness([], {
    grants: [1],
    triage: async () => {
      throw new Error("list failed");
    },
  });
  assert.deepEqual(await h.run(), { kind: "stopped" });
  assert.match(h.log.join("\n"), /triage failed: list failed/);
  assert.equal(h.passes(), 1);
  assert.deepEqual(h.sleeps, []);
  assert.equal(h.releases(), 1);
});

test("a signal during a pass stops after the pass returns", async () => {
  const h: ReturnType<typeof harness> = harness([
    async () => {
      h.controller.abort();
      return idle;
    },
  ]);
  assert.deepEqual(await h.run(), { kind: "stopped" });
  assert.deepEqual(h.sleeps, []);
  assert.equal(h.calls.filter((call) => call === "tryGrant").length, 1);
});

test("a pass that throws after the abort is not an error", async () => {
  const h: ReturnType<typeof harness> = harness([
    async () => {
      h.controller.abort();
      throw new Error("aborted run");
    },
  ]);
  assert.deepEqual(await h.run(), { kind: "stopped" });
  assert.deepEqual(h.sleeps, []);
  assert.doesNotMatch(h.log.join("\n"), /pass failed/);
  // The operator still learns why the stopped pass ended.
  assert.match(h.log.join("\n"), /pass ended after the stop: aborted run/);
});

test("a signal during triage stops before the pass", async () => {
  const h: ReturnType<typeof harness> = harness([worked], {
    grants: [1],
    triage: async () => {
      h.controller.abort();
    },
  });
  assert.deepEqual(await h.run(), { kind: "stopped" });
  assert.equal(h.passes(), 0);
  assert.equal(h.releases(), 1);
});

test("a signal during a wait ends the wait", async () => {
  let started!: () => void;
  const sleeping = new Promise<void>((resolve) => (started = resolve));
  const h = harness([idle, worked], {
    sleep: (_ms, signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
        started();
      }),
  });
  const result = h.run();
  await sleeping;
  h.controller.abort();
  assert.deepEqual(await result, { kind: "stopped" });
  assert.equal(h.passes(), 1);
});

test("an aborted signal at start runs nothing", async () => {
  const h = harness([worked], { grants: [1] });
  h.controller.abort();
  assert.deepEqual(await h.run(), { kind: "stopped" });
  assert.deepEqual(h.calls, []);
});

test("a gate throw is logged and the pass still runs", async () => {
  const h = harness([]);
  h.input.triageGate = {
    async tryGrant() {
      throw new Error("lock service down");
    },
  };
  assert.deepEqual(await h.run(), { kind: "stopped" });
  assert.match(h.log.join("\n"), /triage failed: lock service down/);
  assert.equal(h.passes(), 1);
});
