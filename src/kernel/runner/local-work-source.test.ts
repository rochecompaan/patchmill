import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../../config/config.ts";
import type { RunOnceDeps, RunOnceOutcome } from "../run-once.ts";
import { localTriageGate } from "./local-triage-gate.ts";
import { localWorkSource } from "./local-work-source.ts";
import type { PassResult } from "./shell.ts";

const config = parseConfig({});
const deps = {} as RunOnceDeps;

function source(outcomes: RunOnceOutcome[], recorded: unknown[] = []) {
  let index = 0;
  return localWorkSource({
    config,
    deps,
    runOneIssue: async (_config, _deps, options) => {
      recorded.push(options);
      const outcome = outcomes[index++];
      if (!outcome) throw new Error("no scripted outcome");
      return outcome;
    },
  });
}

const signal = () => new AbortController().signal;
const aborted = () => AbortSignal.abort();

const rows: {
  outcome: RunOnceOutcome;
  signal?: () => AbortSignal;
  expected: PassResult | RegExp;
}[] = [
  { outcome: { status: "completed", issue: 4 }, expected: { kind: "worked" } },
  {
    outcome: {
      status: "completed",
      issue: 4,
      publicationErrors: ["Label update failed: x"],
    },
    expected: /publication failed for issue #4: Label update failed: x/,
  },
  {
    outcome: {
      status: "stopped",
      issue: 4,
      label: "inProgress",
      summary: "s",
      publicationErrors: ["c"],
    },
    expected: /publication failed for issue #4/,
  },
  {
    outcome: { status: "stopped", issue: 4, label: "needsInfo", summary: "s" },
    expected: { kind: "worked" },
  },
  {
    outcome: { status: "stopped", issue: 4, label: "inProgress", summary: "s" },
    expected: {
      kind: "idle",
      reason: "issue #4 waits for a planning pull request",
    },
  },
  {
    outcome: { status: "no-work" },
    expected: { kind: "idle", reason: "no eligible issue" },
  },
  {
    outcome: { status: "claimed-elsewhere", issue: 4 },
    expected: { kind: "idle", reason: "issue #4 is claimed elsewhere" },
  },
  {
    outcome: {
      status: "refused",
      issue: 4,
      reason: "another Run attempt is active",
    },
    expected: { kind: "idle", reason: "another Run attempt is active" },
  },
  {
    outcome: { status: "paused", issue: 4, summary: "s" },
    signal: aborted,
    expected: { kind: "idle", reason: "stopping" },
  },
  {
    outcome: { status: "paused", issue: 4, summary: "s" },
    expected: { kind: "fatal", reason: "run paused without a stop request" },
  },
  {
    outcome: { status: "dry-run", issue: 4, derived: "ambiguous-branches" },
    expected: { kind: "fatal", reason: "unexpected dry-run outcome" },
  },
];

for (const row of rows) {
  const name = `${row.outcome.status}${
    "label" in row.outcome ? ` ${row.outcome.label}` : ""
  }${"publicationErrors" in row.outcome ? " with publication errors" : ""}${
    row.signal ? " after an abort" : ""
  }`;
  test(`the local source maps ${name}`, async () => {
    const pass = source([row.outcome]).pass((row.signal ?? signal)());
    if (row.expected instanceof RegExp)
      await assert.rejects(pass, row.expected);
    else assert.deepEqual(await pass, row.expected);
  });
}

test("the pass passes only its signal", async () => {
  const recorded: unknown[] = [];
  const passSignal = signal();
  await source([{ status: "no-work" }], recorded).pass(passSignal);
  assert.deepEqual(recorded, [{ signal: passSignal }]);
  assert.equal((recorded[0] as { signal: AbortSignal }).signal, passSignal);
});

test("a runOneIssue throw passes through", async () => {
  const error = new Error("fetch failed");
  const work = localWorkSource({
    config,
    deps,
    runOneIssue: async () => {
      throw error;
    },
  });
  await assert.rejects(work.pass(signal()), (thrown) => thrown === error);
});

const needsInfo: RunOnceOutcome = {
  status: "stopped",
  issue: 4,
  label: "needsInfo",
  summary: "s",
};

async function results(outcomes: RunOnceOutcome[]) {
  const work = source(outcomes);
  const seen: (PassResult | string)[] = [];
  for (let index = 0; index < outcomes.length; index += 1) {
    try {
      seen.push(await work.pass(signal()));
    } catch (error) {
      seen.push((error as Error).message);
    }
  }
  return seen;
}

test("the third Needs Info stop in a row is an error pass", async () => {
  const seen = await results([needsInfo, needsInfo, needsInfo, needsInfo]);
  assert.deepEqual(seen.slice(0, 2), [{ kind: "worked" }, { kind: "worked" }]);
  assert.match(String(seen[2]), /3 runs in a row stopped with Needs Info/);
  assert.match(String(seen[3]), /4 runs in a row/);
});

test("the Needs Info streak resets on completed or another stop label", async () => {
  const worked = { kind: "worked" };
  assert.deepEqual(
    await results([
      needsInfo,
      needsInfo,
      { status: "completed", issue: 5 },
      needsInfo,
      needsInfo,
    ]),
    [worked, worked, worked, worked, worked],
  );
  const reset = await results([
    needsInfo,
    needsInfo,
    { status: "stopped", issue: 5, label: "inProgress", summary: "gate" },
    needsInfo,
    needsInfo,
  ]);
  assert.deepEqual(
    [reset[0], reset[1], reset[3], reset[4]],
    [worked, worked, worked, worked],
  );
});

test("idle outcomes do not reset the Needs Info streak", async () => {
  const seen = await results([
    needsInfo,
    needsInfo,
    { status: "no-work" },
    needsInfo,
  ]);
  assert.deepEqual(seen.slice(0, 3), [
    { kind: "worked" },
    { kind: "worked" },
    { kind: "idle", reason: "no eligible issue" },
  ]);
  assert.match(String(seen[3]), /3 runs in a row/);
});

test("a Needs Info stop with publication errors counts in the streak", async () => {
  const seen = await results([
    needsInfo,
    needsInfo,
    { ...needsInfo, publicationErrors: ["Comment failed: x"] },
    needsInfo,
  ]);
  assert.match(String(seen[2]), /publication failed/);
  assert.match(String(seen[3]), /4 runs in a row/);
});

test("the local gate grants at start, then once per interval", async () => {
  let time = new Date(2026, 10, 21, 12).getTime();
  const gate = localTriageGate({
    intervalMs: 5 * 60_000,
    now: () => new Date(time),
  });
  const start = time;
  const grant = await gate.tryGrant();
  assert.ok(grant);
  assert.equal(grant.beforeWrite, undefined);
  await grant.release();
  time = start + 4 * 60_000;
  assert.equal(await gate.tryGrant(), undefined);
  time = start + 5 * 60_000;
  assert.ok(await gate.tryGrant());
  time = start + 9 * 60_000;
  assert.equal(await gate.tryGrant(), undefined);
});
