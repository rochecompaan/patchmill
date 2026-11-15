import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { RunSnapshot, RunState } from "../kernel/run-snapshot.ts";
import { createRunStatus, formatRunStatus } from "./run-status.ts";

const SEP = " \u00a0·\u00a0 ";
function snap(state: RunState, extra: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    issue: 142,
    title: "Show issue and step in status bar",
    runId: "r",
    runDir: "/unused",
    startedAt: "now",
    session: 2,
    state,
    ...extra,
  };
}

// Missing states, stale phases on waits, and incorrect session numbers mislead the operator.
test("labels every run state", () => {
  const cases: [RunSnapshot, string][] = [
    [snap("deriving"), "preparing"],
    [snap("planning", { phase: "planning", session: 1 }), "01 planning"],
    [snap("implementation", { phase: "implementation" }), "02 implementation"],
    [snap("gate-wait", { phase: "planning" }), "awaiting approval"],
    [snap("review-wait", { phase: "implementation" }), "awaiting review"],
    [snap("blocked", { phase: "implementation" }), "blocked"],
    [snap("ended", { phase: "implementation" }), "ended"],
    [snap("planning", { session: 3 }), "03 planning"],
    [snap("implementation"), "02 implementation"],
  ];
  for (const [snapshot, label] of cases)
    assert.equal(
      formatRunStatus(snapshot, 200),
      `#142 Show issue and step in status bar${SEP}${label}`,
    );
});

test("cleans the title and omits a missing one", () => {
  assert.equal(
    formatRunStatus(snap("deriving", { title: "A\n\tB   C " }), 200),
    `#142 A B C${SEP}preparing`,
  );
  for (const title of [undefined, " \n"])
    assert.equal(
      formatRunStatus(snap("deriving", { title }), 200),
      `#142${SEP}preparing`,
    );
  const cleaned = formatRunStatus(
    snap("deriving", { title: "a\u009bb \u001b[31mred\u001b[0m" }),
    200,
  );
  assert.equal(cleaned, `#142 a b red${SEP}preparing`);
});

test("shortens only the title to fit the width", () => {
  const snapshot = snap("implementation", { phase: "implementation" });
  const full = `#142 Show issue and step in status bar${SEP}02 implementation`;
  assert.equal(formatRunStatus(snapshot, visibleWidth(full)), full);
  const shortened = formatRunStatus(snapshot, 40);
  assert.equal(shortened, `#142 Show issue a…${SEP}02 implementation`);
  assert.ok(visibleWidth(shortened) <= 40);
});

test("counts wide characters without splitting graphemes", () => {
  const cjk = formatRunStatus(
    snap("blocked", { title: "状態バーに課題を表示する" }),
    24,
  );
  assert.equal(cjk, `#142 状態バ…${SEP}blocked`);
  assert.ok(visibleWidth(cjk) <= 24);
  const emoji = formatRunStatus(snap("blocked", { title: "👩🏽‍💻👩🏽‍💻👩🏽‍💻 next" }), 22);
  assert.equal(emoji, `#142 👩🏽‍💻👩🏽‍💻…${SEP}blocked`);
  assert.ok(visibleWidth(emoji) <= 22);
});

test("drops the title when no room remains", () => {
  const width = visibleWidth(`#142 ${SEP}02 implementation`) + 1;
  assert.equal(
    formatRunStatus(snap("implementation"), width),
    `#142${SEP}02 implementation`,
  );
});

test("show, refresh and clear drive the patchmill status", () => {
  const calls: [string, string | undefined][] = [];
  let columns = 200;
  const status = createRunStatus({
    setStatus: (key, text) => calls.push([key, text]),
    columns: () => columns,
  });
  status.show(snap("implementation"));
  assert.deepEqual(calls, [
    [
      "patchmill",
      `#142 Show issue and step in status bar${SEP}02 implementation`,
    ],
  ]);
  columns = 40;
  status.refresh();
  assert.deepEqual(calls.at(-1), [
    "patchmill",
    `#142 Show issue a…${SEP}02 implementation`,
  ]);
  status.clear();
  assert.deepEqual(calls.at(-1), ["patchmill", undefined]);
  const count = calls.length;
  status.refresh();
  assert.equal(calls.length, count);
});

test("status errors are ignored", () => {
  for (const fails of ["setStatus", "columns"]) {
    const status = createRunStatus({
      setStatus: () => {
        if (fails === "setStatus") throw Error("stale context");
      },
      columns: () => {
        if (fails === "columns") throw Error("unavailable");
        return 80;
      },
    });
    assert.doesNotThrow(() => status.show(snap("planning")));
    assert.doesNotThrow(() => status.refresh());
    assert.doesNotThrow(() => status.clear());
  }
});
