import assert from "node:assert/strict";
import { test } from "node:test";
import type { PatchmillConfig } from "../config/config.ts";
import { prepareInteractiveRun } from "./interactive-start.ts";
import type { RunOnceDeps } from "./run-once.ts";
import type { TrackedIssue } from "./workflow-state.ts";

const issue = (number: number, state = "open") =>
  ({
    number,
    state,
    status: "ready",
    createdAt: "2026-01-01",
  }) as unknown as TrackedIssue;

function deps(options: { issues?: TrackedIssue[]; blockers?: number[] } = {}): {
  deps: RunOnceDeps;
  synced: (number | undefined)[];
} {
  const issues = options.issues ?? [issue(7)];
  const synced: (number | undefined)[] = [];
  return {
    synced,
    deps: {
      repoRoot: "/r",
      now: () => new Date(),
      output: { stdout: () => {}, stderr: () => {} },
      workflow: {
        sync: async (n?: number) => {
          synced.push(n);
        },
        issue: async (n: number) => {
          const found = issues.find((i) => i.number === n);
          if (!found) throw new Error(`Issue #${n} not found`);
          return found;
        },
        openIssues: async () => issues,
      },
      host: {
        listIssueDependencies: async () =>
          (options.blockers ?? []).map((number) => ({
            number,
            state: "open",
            repository: "o/r",
          })),
        repository: async () => ({ owner: "o", repo: "r" }),
      },
    } as unknown as RunOnceDeps,
  };
}
const config = {} as PatchmillConfig;

test("prepareInteractiveRun refuses what selectRunIssue refuses", async () => {
  const d = deps({ blockers: [1] });
  const start = await prepareInteractiveRun({
    config,
    deps: d.deps,
    issue: 7,
    report: () => {},
    sweep: async () => {},
  });
  assert.equal(start.kind, "refused");
  assert.match(
    start.kind === "refused" ? start.reason : "",
    /Issue #7 is blocked by: o\/r#1/,
  );
});

test("prepareInteractiveRun returns none when no issue is eligible", async () => {
  const d = deps({ issues: [issue(7, "closed")] });
  const start = await prepareInteractiveRun({
    config,
    deps: d.deps,
    report: () => {},
    sweep: async () => {},
  });
  assert.deepEqual(start, { kind: "none" });
});

test("prepareInteractiveRun returns cancelled when the signal aborts during the sweep", async () => {
  const d = deps();
  const controller = new AbortController();
  const start = await prepareInteractiveRun({
    config,
    deps: d.deps,
    issue: 7,
    report: () => {},
    signal: controller.signal,
    sweep: async (input) => {
      assert.equal(input.signal, controller.signal);
      controller.abort();
    },
  });
  assert.deepEqual(start, { kind: "cancelled" });
  assert.deepEqual(d.synced, []);
});

test("prepareInteractiveRun returns ready with the selected issue", async () => {
  const d = deps();
  const reports: string[] = [];
  const start = await prepareInteractiveRun({
    config,
    deps: d.deps,
    issue: 7,
    report: (line) => reports.push(line),
    sweep: async (input) => input.report("swept"),
  });
  assert.deepEqual(start, { kind: "ready", issue: 7 });
  assert.deepEqual(d.synced, [7]);
  assert.deepEqual(reports, ["swept"]);
});
