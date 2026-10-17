import assert from "node:assert/strict";
import { test } from "node:test";
import type { Facts } from "./facts.ts";
import { closesIssue, verifyOutcome, type VerifyInput } from "./verify.ts";

const facts: Facts = {
  branch: "agent/issue-12-example",
  remoteBranchExists: true,
  worktree: "/worktree",
  baseBranch: "main",
  specPath: "docs/specs/example.md",
  expectedSpecPath: "docs/specs/example.md",
  expectedPlanPath: "docs/plans/example.md",
  specApproved: false,
  pullRequest: {
    number: 21,
    url: "https://example.test/pulls/21",
    state: "open",
    draft: false,
    body: "Fixes #12",
    headBranch: "agent/issue-12-example",
  },
};
const input: VerifyInput = {
  issue: 12,
  repository: { owner: "owner", repo: "repo" },
  phase: "implementation",
  result: {
    ok: true,
    result: { status: "done", summary: "The work is ready." },
  },
  session: { exitCode: 0, timedOut: false, aborted: false },
  facts,
  gateRequired: true,
  logPath: "/logs/session.log",
  uncommitted: false,
  unpushed: 0,
};

for (const [body, expected] of [
  ["Fixes #12", true],
  ["Fixes #123", false],
  ["resolves owner/repo#12", true],
  ["see #12", false],
  ["CLOSE #12", true],
  ["closes #12", true],
  ["closed #12", true],
  ["fix #12", true],
  ["fixed #12", true],
  ["resolve #12", true],
  ["resolved owner-name/repo.name#12", false],
  ["Fixes\n#12", true],
  ["prefixfixes #12", false],
  ["Fixing #12", false],
  ["Fixes#12", false],
  ["Fixes https://example.test/owner/repo/issues/12", false],
  ["Fixes owner/repo #12", false],
  ["Fixes #12suffix", true],
] as const) {
  test(`closesIssue(${JSON.stringify(body)}) is ${expected}`, () => {
    assert.equal(closesIssue(body, 12, input.repository), expected);
  });
}

test("closesIssue uses the supplied issue number", () => {
  assert.equal(closesIssue("Fixes #123", 123, input.repository), true);
  assert.equal(closesIssue("Fixes #12", 123, input.repository), false);
});

for (const [name, result, session, reasons] of [
  [
    "parser failure",
    { ok: false, reason: "invalid JSON" },
    input.session,
    [/invalid JSON/],
  ],
  [
    "timeout overrides done",
    input.result,
    { exitCode: null, timedOut: true, aborted: false },
    [/timed out/i, /The work is ready\./],
  ],
  [
    "abort overrides done",
    input.result,
    { exitCode: 1, timedOut: false, aborted: true },
    [/abort/i, /The work is ready\./],
  ],
  [
    "all failures remain visible",
    { ok: false, reason: "no result" },
    { exitCode: 2, timedOut: true, aborted: true },
    [/no result/, /timed out/i, /abort/i],
  ],
] satisfies [
  string,
  VerifyInput["result"],
  VerifyInput["session"],
  RegExp[],
][]) {
  test(name, () => {
    const outcome = verifyOutcome({ ...input, result, session });
    assert.equal(outcome.kind, "stop");
    if (outcome.kind !== "stop") return;
    assert.equal(outcome.label, "needsInfo");
    for (const reason of reasons) assert.match(outcome.comment, reason);
    assert.match(
      outcome.comment,
      new RegExp(`exit code: ${session.exitCode}`, "i"),
    );
    assert.ok(outcome.comment.includes(input.logPath));
  });
}

for (const status of ["needs-input", "failed"] as const) {
  test(`${status} stops despite valid PR facts`, () => {
    const outcome = verifyOutcome({
      ...input,
      result: {
        ok: true,
        result: { status, summary: "Please supply the missing token." },
      },
      session: { ...input.session, exitCode: 1 },
    });
    assert.equal(outcome.kind, "stop");
    if (outcome.kind !== "stop") return;
    assert.equal(outcome.label, "needsInfo");
    assert.match(outcome.comment, /Please supply the missing token\./);
    assert.match(outcome.comment, /exit code: 1/i);
  });
}

for (const [gateRequired, specApproved, expected] of [
  [true, false, "stop"],
  [true, true, "advance"],
  [false, false, "advance"],
  [false, true, "advance"],
] as const) {
  test(`planning gate=${gateRequired} approval=${specApproved} yields ${expected}`, () => {
    const outcome = verifyOutcome({
      ...input,
      phase: "planning",
      facts: { ...facts, specApproved, pullRequest: undefined },
      gateRequired,
      session: { ...input.session, exitCode: 1 },
      uncommitted: true,
      unpushed: 2,
    });
    if (expected === "advance") {
      assert.deepEqual(outcome, { kind: "advance" });
    } else {
      assert.equal(outcome.kind, "stop");
      if (outcome.kind !== "stop") return;
      assert.equal(outcome.label, "specReview");
      assert.match(outcome.comment, /review/i);
      assert.match(outcome.comment, /The work is ready\./);
      assert.match(outcome.comment, /exit code: 1/i);
      assert.deepEqual(outcome.warnings, [
        "uncommitted changes in the worktree",
        "unpushed commits",
      ]);
    }
  });
}

for (const [name, patch, diagnostic] of [
  ["remote branch missing", { remoteBranchExists: false }, /remote branch/i],
  ["spec missing", { specPath: undefined }, /spec/i],
] satisfies [string, Partial<Facts>, RegExp][]) {
  test(`planning cannot advance or request review when ${name}`, () => {
    const outcome = verifyOutcome({
      ...input,
      phase: "planning",
      facts: { ...facts, ...patch },
    });
    assert.equal(outcome.kind, "stop");
    if (outcome.kind !== "stop") return;
    assert.equal(outcome.label, "needsInfo");
    assert.match(outcome.comment, /claim was not verified/i);
    assert.match(outcome.comment, diagnostic);
    assert.match(outcome.comment, /The work is ready\./);
  });
}

for (const [name, pullRequest, diagnostic] of [
  ["missing PR", undefined, /no pull request/i],
  ["draft PR", { ...facts.pullRequest!, draft: true }, /draft/i],
  ["closed PR", { ...facts.pullRequest!, state: "closed" }, /closed/i],
  ["merged PR", { ...facts.pullRequest!, state: "merged" }, /merged/i],
  [
    "wrong head",
    { ...facts.pullRequest!, headBranch: "other-branch" },
    /head.*branch/i,
  ],
  ["wrong issue", { ...facts.pullRequest!, body: "Closes #123" }, /clos.*#12/i],
  ["empty body", { ...facts.pullRequest!, body: "" }, /clos.*#12/i],
] satisfies [string, Facts["pullRequest"], RegExp][]) {
  test(`implementation rejects ${name} with a specific diagnostic`, () => {
    const outcome = verifyOutcome({
      ...input,
      facts: { ...facts, pullRequest },
      session: { ...input.session, exitCode: 1 },
    });
    assert.equal(outcome.kind, "stop");
    if (outcome.kind !== "stop") return;
    assert.equal(outcome.label, "needsInfo");
    assert.match(outcome.comment, /claim was not verified/i);
    assert.match(outcome.comment, diagnostic);
    assert.match(outcome.comment, /The work is ready\./);
    assert.match(outcome.comment, /exit code: 1/i);
  });
}

for (const exitCode of [0, 1, null]) {
  test(`verified PR succeeds with exit code ${exitCode} and no extra planning gate`, () => {
    const outcome = verifyOutcome({
      ...input,
      session: { ...input.session, exitCode },
      facts: { ...facts, specPath: undefined, remoteBranchExists: false },
    });
    assert.equal(outcome.kind, "stop");
    if (outcome.kind !== "stop") return;
    assert.equal(outcome.label, "done");
    assert.match(outcome.comment, /The work is ready\./);
    assert.match(outcome.comment, new RegExp(`exit code: ${exitCode}`, "i"));
    assert.deepEqual(outcome.warnings, []);
  });
}

for (const [uncommitted, unpushed, warnings] of [
  [false, 0, []],
  [true, 0, ["uncommitted changes in the worktree"]],
  [false, 2, ["unpushed commits"]],
  [false, "no-remote-branch", ["unpushed commits"]],
  [true, 1, ["uncommitted changes in the worktree", "unpushed commits"]],
] satisfies [boolean, VerifyInput["unpushed"], string[]][]) {
  test(`warnings do not fail a valid PR: dirty=${uncommitted}, unpushed=${unpushed}`, () => {
    const outcome = verifyOutcome({ ...input, uncommitted, unpushed });
    assert.equal(outcome.kind, "stop");
    if (outcome.kind !== "stop") return;
    assert.equal(outcome.label, "done");
    assert.deepEqual(outcome.warnings, warnings);
  });
}

test("warnings remain available on a parser failure", () => {
  const outcome = verifyOutcome({
    ...input,
    result: { ok: false, reason: "no result" },
    uncommitted: true,
    unpushed: "no-remote-branch",
  });
  assert.equal(outcome.kind, "stop");
  if (outcome.kind !== "stop") return;
  assert.equal(outcome.label, "needsInfo");
  assert.deepEqual(outcome.warnings, [
    "uncommitted changes in the worktree",
    "unpushed commits",
  ]);
});

for (const body of [
  "Fixes other/repo#12",
  "Fixes owner/other#12",
  "Fixes prefixowner/repo#12",
  "Fixes owner/repo#123",
  "Fixes other/owner/repo#12",
]) {
  test(`foreign or partial reference cannot verify done: ${body}`, () => {
    const result = verifyOutcome({
      ...input,
      facts: { ...facts, pullRequest: { ...facts.pullRequest!, body } },
    });
    assert.equal(result.kind, "stop");
    if (result.kind === "stop") assert.equal(result.label, "needsInfo");
  });
}
