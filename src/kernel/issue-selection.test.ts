import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { FakeHost, writeFakeHostState } from "../../test-support/fake-host.ts";
import { DEFAULT_CONFIG } from "../config/config.ts";
import type { Issue, IssueDependency } from "../host/types.ts";
import { LabelWorkflowState } from "./label-workflow.ts";
import { selectRunIssue } from "./issue-selection.ts";

function issue(number: number, labels = ["agent-ready"]): Issue {
  return {
    number,
    labels,
    title: `Issue ${number}`,
    body: "",
    state: "open",
    url: "url",
    author: "owner",
    createdAt: `2026-01-${number.toString().padStart(2, "0")}`,
    comments: [],
  };
}
async function setup(t: TestContext, dependencies: IssueDependency[] = []) {
  const root = await mkdtemp(join(tmpdir(), "patchmill-selection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateFile = join(root, "host.json");
  writeFakeHostState(stateFile, {
    issues: [issue(10), issue(9), issue(1, [])],
    dependencies: { 9: dependencies },
  });
  const host = new FakeHost(stateFile);
  const warnings: string[] = [];
  return {
    host,
    stateFile,
    warnings,
    select: (n?: number) =>
      selectRunIssue({
        host,
        workflow: new LabelWorkflowState(host, DEFAULT_CONFIG.labels),
        ...(n === undefined ? {} : { issue: n }),
        warn: (n, reason) => warnings.push(`#${n}: ${reason}`),
      }),
  };
}

for (const repository of ["fixture/repo", "other/project"]) {
  test(`selection skips older work with an open dependency in ${repository}`, async (t) => {
    const f = await setup(t, [{ repository, number: 1, state: "open" }]);
    const selected = await f.select();
    assert.equal(selected.kind, "selected");
    if (selected.kind === "selected") assert.equal(selected.issue.number, 10);
    const refused = await f.select(9);
    assert.equal(refused.kind, "refused");
    if (refused.kind === "refused")
      assert.match(refused.reason, new RegExp(`${repository}#1`));
  });
}

test("explicit refusal annotates a same-repository Done blocker", async (t) => {
  const f = await setup(t, [
    { repository: "FIXTURE/REPO", number: 1, state: "open" },
  ]);
  const state = f.host.state();
  state.issues.find((i) => i.number === 1)!.labels = [
    DEFAULT_CONFIG.labels.done,
  ];
  writeFakeHostState(f.stateFile, state);
  assert.deepEqual(await f.select(9), {
    kind: "refused",
    issue: 9,
    reason: "Issue #9 is blocked by: FIXTURE/REPO#1 (Done, PR not merged).",
  });
  assert.equal(
    f.host.state().calls.filter((call) => call === "repository").length,
    1,
  );
});

for (const failure of ["repository", "blocker"] as const) {
  test(`explicit refusal survives a failed ${failure} status lookup`, async (t) => {
    const f = await setup(t, [
      { repository: "fixture/repo", number: 1, state: "open" },
    ]);
    if (failure === "repository")
      f.host.repository = async () => {
        throw new Error("unavailable");
      };
    const workflow = new LabelWorkflowState(f.host, DEFAULT_CONFIG.labels);
    const read = workflow.issue.bind(workflow);
    const reads: number[] = [];
    workflow.issue = async (n) => {
      reads.push(n);
      if (n === 1) throw new Error("unavailable");
      return read(n);
    };
    assert.deepEqual(
      await selectRunIssue({
        host: f.host,
        workflow,
        issue: 9,
        warn: () => {},
      }),
      {
        kind: "refused",
        issue: 9,
        reason: "Issue #9 is blocked by: fixture/repo#1.",
      },
    );
    assert.deepEqual(reads, failure === "blocker" ? [9, 1] : [9]);
  });
}

test("automatic selection does not read blocker workflow issues or repository", async (t) => {
  const f = await setup(t, [
    { repository: "fixture/repo", number: 1, state: "open" },
  ]);
  const workflow = new LabelWorkflowState(f.host, DEFAULT_CONFIG.labels);
  let reads = 0;
  workflow.issue = async () => {
    reads++;
    throw new Error("unexpected lookup");
  };
  assert.equal(
    (await selectRunIssue({ host: f.host, workflow, warn: () => {} })).kind,
    "selected",
  );
  assert.equal(reads, 0);
  assert.equal(
    f.host.state().calls.filter((call) => call === "repository").length,
    0,
  );
});

test("closure, reopening, and unlinking change selection without labels, comments, or triage", async (t) => {
  const f = await setup(t, [
    { repository: "FIXTURE/REPO", number: 1, state: "open" },
  ]);
  let selected = await f.select();
  assert.equal(selected.kind === "selected" && selected.issue.number, 10);
  const state = f.host.state();
  state.issues.find((i) => i.number === 1)!.state = "closed";
  writeFakeHostState(f.stateFile, state);
  selected = await f.select();
  assert.equal(selected.kind === "selected" && selected.issue.number, 9);
  state.issues.find((i) => i.number === 1)!.state = "open";
  writeFakeHostState(f.stateFile, state);
  selected = await f.select();
  assert.equal(selected.kind === "selected" && selected.issue.number, 10);
  state.dependencies = {};
  writeFakeHostState(f.stateFile, state);
  selected = await f.select();
  assert.equal(selected.kind === "selected" && selected.issue.number, 9);
  assert.equal(
    f.host
      .state()
      .calls.some((call) =>
        /setLabels:|commentIssue:|addIssueDependency:/.test(call),
      ),
    false,
  );
});

test("unreadable dependencies warn and skip automatically but refuse an explicit issue", async (t) => {
  const f = await setup(t);
  const read = f.host.listIssueDependencies.bind(f.host);
  f.host.listIssueDependencies = async (n) => {
    if (n === 9) throw new Error("dependency access denied");
    return read(n);
  };
  const selected = await f.select();
  assert.equal(selected.kind === "selected" && selected.issue.number, 10);
  assert.match(f.warnings.join("\n"), /#9.*dependency access denied/);
  const refused = await f.select(9);
  assert.equal(refused.kind, "refused");
  if (refused.kind === "refused")
    assert.match(refused.reason, /dependency access denied/);
});

test("automatic selection exhausts blocked candidates before reporting no work", async (t) => {
  const f = await setup(t);
  f.host.listIssueDependencies = async () => [
    { repository: "fixture/repo", number: 1, state: "open" },
  ];
  assert.deepEqual(await f.select(), { kind: "none" });
});

test("explicit selection retains its label override but not a dependency override", async (t) => {
  const f = await setup(t);
  assert.equal((await f.select(1)).kind, "selected");
  const state = f.host.state();
  state.issues.find((i) => i.number === 9)!.labels = ["in-progress"];
  state.dependencies[9] = [
    { repository: "fixture/repo", number: 1, state: "open" },
  ];
  writeFakeHostState(f.stateFile, state);
  assert.equal((await f.select(9)).kind, "refused");
  state.issues.find((i) => i.number === 1)!.state = "closed";
  writeFakeHostState(f.stateFile, state);
  assert.equal((await f.select(1)).kind, "refused");
  assert.equal((await f.select(999)).kind, "refused");
});
