import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { FakeHost, writeFakeHostState } from "../../test-support/fake-host.ts";
import { parseConfig } from "../config/config.ts";
import type { Issue } from "../host/types.ts";
import { createTriagePi } from "../../test-support/triage-fixture.ts";
import { LabelWorkflowState } from "./label-workflow.ts";
import {
  hasReply,
  runTriage,
  selectTriageCandidates,
  type TriageOptions,
  type TriageProgressEvent,
} from "./triage.ts";

function issue(number: number, labels: string[] = []): Issue {
  return {
    number,
    labels,
    title: "Fix login",
    body: "Details",
    author: "reporter",
    state: "open",
    url: "https://example.invalid/issue",
    createdAt: "2026-10-01",
    comments: [],
  };
}
function comment(author: string, createdAt: string) {
  return { author, createdAt, body: "Clarification" };
}
// Wrong eligibility, stale comment trust, or hardcoded labels break this selection.
test("selects open unclassified issues and needs-info with the latest trusted reply", async (t) => {
  const labels = parseConfig({}).labels;
  const issues = [
    issue(1),
    ...Object.values(labels).map((label, n) => issue(n + 2, [label])),
  ];
  issues.push({ ...issue(20), state: "closed" });
  const trusted = issue(21, [labels.needsInfo]);
  trusted.comments = [
    comment("owner", "2026-10-03"),
    comment("outsider", "2026-10-02"),
  ];
  const untrusted = issue(22, [labels.needsInfo]);
  untrusted.comments = [
    comment("owner", "2026-10-01"),
    comment("outsider", "2026-10-04"),
  ];
  issues.push(trusted, untrusted, issue(23, ["bug"]));
  const root = await fs.mkdtemp(join(tmpdir(), "patchmill-triage-selection-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = join(root, "host.json");
  writeFakeHostState(state, { issues });
  const workflow = new LabelWorkflowState(new FakeHost(state), labels);
  assert.deepEqual(
    selectTriageCandidates(await workflow.openIssues(), ["owner"]).map(
      (i) => i.number,
    ),
    [1, 21, 23],
  );
  writeFakeHostState(state, {
    issues: [issue(1, ["queue"]), issue(2, ["agent-ready"])],
  });
  assert.deepEqual(
    selectTriageCandidates(
      await new LabelWorkflowState(new FakeHost(state), {
        ...labels,
        ready: "queue",
      }).openIssues(),
      [],
    ).map((i) => i.number),
    [2],
  );
});

async function setup(t: TestContext, outputs: string[], issues = [issue(9)]) {
  const root = await fs.mkdtemp(join(tmpdir(), "patchmill-triage-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = join(root, "host.json");
  writeFakeHostState(state, { issues });
  const host = new FakeHost(state);
  const piCommand = await createTriagePi(root, outputs);
  const stdout: string[] = [],
    stderr: string[] = [];
  t.mock.method(
    process.stdout,
    "write",
    (chunk: string, callback?: () => void) => {
      stdout.push(String(chunk));
      callback?.();
      return true;
    },
  );
  t.mock.method(
    process.stderr,
    "write",
    (chunk: string, callback?: () => void) => {
      stderr.push(String(chunk));
      callback?.();
      return true;
    },
  );
  const config = parseConfig({ host: { login: "owner" } });
  const deps = {
    host,
    workflow: new LabelWorkflowState(host, config.labels),
    repoRoot: root,
    piCommand,
    now: () => new Date(2026, 9, 15, 12),
    output: {
      stdout: (s: string) => stdout.push(s),
      stderr: (s: string) => stderr.push(s),
    },
  };
  return {
    root,
    config,
    deps,
    host,
    stdout,
    stderr,
    run: (options: TriageOptions = {}) => runTriage(config, deps, options),
  };
}
const block = (
  label = "agent-ready",
  comment = "Looks clear.",
  blockedBy: number[] = [],
) => `\`\`\`json\n${JSON.stringify({ label, comment, blockedBy })}\n\`\`\``;

for (const blockedBy of [
  [9],
  [1, 1],
  [0],
  [-1],
  [1.5],
  ["1"],
  [9007199254740992],
  null,
  undefined,
]) {
  test(`invalid structured blockers cannot mutate the host: ${JSON.stringify(blockedBy)}`, async (t) => {
    const value = JSON.stringify({
      label: "agent-ready",
      comment: "",
      blockedBy,
    });
    const f = await setup(t, [`\`\`\`json\n${value}\n\`\`\``]);
    assert.deepEqual(await f.run(), []);
    assert.equal(
      f.host
        .state()
        .calls.some((call) =>
          /createLabel|setLabels|commentIssue|addIssueDependency/.test(call),
        ),
      false,
    );
  });
}

for (const label of ["needs-info", "agent-unsuitable", "blocked"]) {
  test(`non-ready outcome ${label} cannot add blockers`, async (t) => {
    const f = await setup(t, [block(label, "", [1])]);
    assert.deepEqual(await f.run(), []);
    assert.equal(
      f.host
        .state()
        .calls.some((call) =>
          /createLabel|setLabels|commentIssue|addIssueDependency/.test(call),
        ),
      false,
    );
  });
}

test("triage adds only missing local links before labels and includes current dependencies in the prompt", async (t) => {
  const f = await setup(
    t,
    [block("agent-ready", "Wait for prerequisites", [1, 2])],
    [issue(9), issue(1, ["agent-unsuitable"]), issue(2, ["agent-unsuitable"])],
  );
  writeFakeHostState(join(f.root, "host.json"), {
    ...f.host.state(),
    dependencies: {
      9: [
        { repository: "FIXTURE/REPO", number: 1, state: "open" },
        { repository: "other/project", number: 2, state: "open" },
      ],
    },
  });
  const progress: TriageProgressEvent[] = [];
  assert.deepEqual(
    await f.run({ onProgress: (event) => progress.push(event) }),
    [{ issue: 9, status: "ready", applied: true }],
  );
  const state = f.host.state();
  assert.deepEqual(
    state.calls.filter((call) => call.startsWith("addIssueDependency:")),
    ["addIssueDependency:9:2"],
  );
  assert.ok(
    state.calls.indexOf("addIssueDependency:9:2") <
      state.calls.indexOf("setLabels:9"),
  );
  assert.equal(state.dependencies[9]!.length, 3);
  const event = progress.find((event) => event.type === "triaged");
  assert.ok(event && event.type === "triaged");
  assert.deepEqual(event.blockedBy, [2]);
  assert.equal(event.commentKind, "posted");
  const launch = JSON.parse(
    (await fs.readFile(join(f.root, "launches"), "utf8")).trim(),
  );
  const prompt = await fs.readFile(launch.args.at(-1).slice(1), "utf8");
  assert.match(
    prompt,
    /Dependencies: FIXTURE\/REPO#1 \(open\), other\/project#2 \(open\)/,
  );
});

test("partial dependency writes warn, preserve added links, and retry only missing links", async (t) => {
  const f = await setup(
    t,
    [
      block("agent-ready", "", [1, 2]),
      block(),
      block("agent-ready", "", [1, 2]),
    ],
    [
      issue(9),
      issue(10),
      issue(1, ["agent-unsuitable"]),
      issue(2, ["agent-unsuitable"]),
    ],
  );
  const add = f.host.addIssueDependency.bind(f.host);
  let fail = true;
  f.host.addIssueDependency = async (n, blocker) => {
    if (blocker === 2 && fail) throw new Error("write refused");
    await add(n, blocker);
  };
  assert.deepEqual(await f.run(), [
    { issue: 10, status: "ready", applied: true },
  ]);
  assert.equal(f.host.state().calls.includes("setLabels:9"), false);
  assert.equal(f.host.state().calls.includes("commentIssue:9"), false);
  assert.deepEqual(
    f.host.state().dependencies[9]!.map((link) => link.number),
    [1],
  );
  assert.match(f.stderr.join("\n"), /#9.*#2.*write refused/);
  fail = false;
  assert.deepEqual(await f.run(), [
    { issue: 9, status: "ready", applied: true },
  ]);
  assert.deepEqual(
    f.host
      .state()
      .calls.filter((call) => call.startsWith("addIssueDependency:")),
    ["addIssueDependency:9:1", "addIssueDependency:9:2"],
  );
});

test("unreadable dependency context skips Pi for that issue and continues independently", async (t) => {
  const f = await setup(t, [block()], [issue(9), issue(10)]);
  f.host.listIssueDependencies = async (n) => {
    if (n === 9) throw new Error("read denied");
    return [];
  };
  assert.deepEqual(await f.run(), [
    { issue: 10, status: "ready", applied: true },
  ]);
  assert.match(f.stderr.join("\n"), /9.*read denied/);
  assert.equal(
    (await fs.readFile(join(f.root, "launches"), "utf8")).trim().split("\n")
      .length,
    1,
  );
});

test("dependency dry-run previews missing links without any host writes", async (t) => {
  const f = await setup(
    t,
    [block("agent-ready", "", [1])],
    [issue(9), issue(1, ["agent-unsuitable"])],
  );
  const progress: TriageProgressEvent[] = [];
  await f.run({ dryRun: true, onProgress: (event) => progress.push(event) });
  assert.equal(
    f.host
      .state()
      .calls.some((call) =>
        /createLabel|listLabels|setLabels|commentIssue|addIssueDependency/.test(
          call,
        ),
      ),
    false,
  );
  const event = progress.find((event) => event.type === "triaged");
  assert.ok(event && event.type === "triaged");
  assert.deepEqual(event.blockedBy, [1]);
  assert.equal(event.applied, false);
});

test("applies a validated result and launches isolated Pi with the configured envelope", async (t) => {
  const f = await setup(t, [block()]);
  assert.deepEqual(await f.run(), [
    { issue: 9, status: "ready", applied: true },
  ]);
  assert.deepEqual(f.host.state().issues[0]!.labels, ["agent-ready"]);
  assert.equal(
    f.host.state().issues[0]!.comments[0]!.body,
    "<!-- patchmill:kernel-comment -->\n\nIssue #9: agent-ready\n\nLooks clear.",
  );
  const launch = JSON.parse(
    (await fs.readFile(join(f.root, "launches"), "utf8")).trim(),
  );
  assert.equal(launch.cwd, f.root);
  assert.equal(launch.agentDir, resolve(f.root, f.config.pi.agentDir));
  assert.equal(launch.args.includes("-e"), false);
  assert.equal(
    launch.args[launch.args.indexOf("--skill") + 1],
    resolve(f.root, f.config.skills.triage),
  );
  const session = launch.args[launch.args.indexOf("--session-dir") + 1];
  assert.match(session, /\/triage\/20261015-120000-[0-9a-f]{4}\/sessions\/1$/);
  const prompt = await fs.readFile(launch.args.at(-1).slice(1), "utf8");
  assert.match(prompt, /Fix login/);
  assert.match(prompt, /agent-ready/);
});

test("automatic triage processes eligible issues in ascending issue-number order regardless of host order", async (t) => {
  const f = await setup(
    t,
    [block(), block(), block(), block()],
    [
      issue(12),
      issue(3, ["agent-ready"]),
      issue(2),
      issue(10),
      issue(1),
      issue(4, ["needs-info"]),
    ],
  );
  const started: number[] = [];
  const outcomes = await f.run({
    onProgress: (event) => {
      if (event.type === "started") started.push(event.issue.number);
    },
  });
  assert.deepEqual(started, [1, 2, 10, 12]);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.issue),
    [1, 2, 10, 12],
  );
  assert.deepEqual(f.stderr, []);
});

test("creates missing configured workflow labels once before applying triage results", async (t) => {
  const f = await setup(
    t,
    [block("queue"), block("needs-info")],
    [issue(9), issue(10)],
  );
  f.config.labels.ready = "queue";
  writeFakeHostState(join(f.root, "host.json"), {
    ...f.host.state(),
    labels: ["bug", "needs-info"],
  });
  const set = f.host.setLabels.bind(f.host);
  f.host.setLabels = async (n, add, remove) => {
    const existing = f.host.state().labels;
    const missing = [...add, ...remove].filter(
      (label) => !existing.includes(label),
    );
    if (missing.length)
      throw new Error(`Labels not found: ${missing.join(", ")}`);
    await set(n, add, remove);
  };
  assert.deepEqual(await f.run(), [
    { issue: 9, status: "ready", applied: true },
    { issue: 10, status: "needsInfo", applied: true },
  ]);
  assert.deepEqual(
    f.host.state().issues.map((i) => i.labels),
    [["queue"], ["needs-info"]],
  );
  assert.deepEqual(
    new Set(f.host.state().labels),
    new Set([
      "bug",
      "queue",
      "needs-info",
      "in-progress",
      "agent-done",
      "agent-unsuitable",
    ]),
  );
  assert.equal(
    f.host.state().calls.filter((call) => call === "listLabels").length,
    1,
  );
  assert.equal(
    f.host.state().calls.filter((call) => call.startsWith("createLabel:"))
      .length,
    4,
  );
  assert.deepEqual(f.stderr, []);
});

test("dry-run still invokes Pi and reports label and comment without Host writes", async (t) => {
  const f = await setup(t, [block()]);
  const before = f.host.state().issues;
  const progress: TriageProgressEvent[] = [];
  assert.deepEqual(
    await f.run({ dryRun: true, onProgress: (event) => progress.push(event) }),
    [{ issue: 9, status: "ready", applied: false }],
  );
  assert.deepEqual(f.host.state().issues, before);
  const preview = progress.find((event) => event.type === "triaged");
  assert.ok(preview);
  assert.equal(preview.finalStatus, "ready");
  assert.equal(preview.comment, "Looks clear.");
  assert.equal(preview.applied, false);
  assert.equal(preview.commentKind, "preview");
  assert.equal(
    f.host
      .state()
      .calls.some((c) =>
        /listLabels|createLabel|setLabels|commentIssue/.test(c),
      ),
    false,
  );
});

test("invalid results do not create repository labels or change issues", async (t) => {
  const f = await setup(t, ["no block"]);
  const before = f.host.state();
  assert.deepEqual(await f.run(), []);
  assert.deepEqual(f.host.state().issues, before.issues);
  assert.deepEqual(f.host.state().labels, before.labels);
  assert.equal(
    f.host
      .state()
      .calls.some((call) => /createLabel|setLabels|commentIssue/.test(call)),
    false,
  );
});

for (const invalid of [
  "no block",
  "```json\n{broken}\n```",
  block("wontfix"),
  '```json\n{"label":"agent-ready"}\n```',
  '```json\n{"label":"agent-ready","comment":5}\n```',
  '```json\n{"label":"agent-ready","comment":"","extra":true}\n```',
]) {
  test(`invalid result skips without writes and continues: ${invalid}`, async (t) => {
    const f = await setup(t, [invalid, block()], [issue(9), issue(10)]);
    assert.deepEqual(await f.run(), [
      { issue: 10, status: "ready", applied: true },
    ]);
    assert.deepEqual(f.host.state().issues[0]!.labels, []);
    assert.deepEqual(f.host.state().issues[0]!.comments, []);
    assert.match(f.stderr.join("\n"), /9/);
  });
}

test("explicit closed issue bypasses selection; configured needsInfo is not also removed", async (t) => {
  const f = await setup(
    t,
    [block("question", "")],
    [
      {
        ...issue(9, ["queue", "question", "nope", "wait", "bug", "agent-done"]),
        state: "closed",
      },
    ],
  );
  f.config.labels = {
    ...f.config.labels,
    ready: "queue",
    needsInfo: "question",
    unsuitable: "nope",
  };
  f.deps.workflow = new LabelWorkflowState(f.host, f.config.labels);
  const set = f.host.setLabels.bind(f.host);
  f.host.setLabels = async (n, add, remove) => {
    assert.deepEqual(add, ["question"]);
    assert.deepEqual(remove.sort(), [
      "agent-done",
      "in-progress",
      "nope",
      "queue",
    ]);
    await set(n, add, remove);
  };
  assert.deepEqual(await f.run({ issue: 9 }), [
    { issue: 9, status: "needsInfo", applied: true },
  ]);
  assert.deepEqual(f.host.state().issues[0]!.labels, [
    "question",
    "wait",
    "bug",
  ]);
  assert.deepEqual(f.host.state().issues[0]!.comments, []);
});

test("hydrates needsInfo comments before selection using configured owner trust", async (t) => {
  const candidate = issue(9, ["needs-info"]);
  candidate.comments = [comment("owner", "2026-10-15")];
  const f = await setup(t, [block()], [candidate]);
  const list = f.host.listOpenIssues.bind(f.host);
  f.host.listOpenIssues = async () =>
    (await list()).map((i) => ({ ...i, comments: [] }));
  assert.equal((await f.run())[0]?.issue, 9);
});

test("last JSON block wins and trailing prose is ignored; configured wontfix is allowed", async (t) => {
  const f = await setup(t, [
    block("bad") + "\n" + block("wontfix", "") + "\ntrailing",
  ]);
  f.config.labels.unsuitable = "wontfix";
  assert.equal((await f.run())[0]?.status, "unsuitable");
});

test("pre-cancelled batch starts no session and mutates nothing", async (t) => {
  const f = await setup(t, [block()]);
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await f.run({ signal: controller.signal }), []);
  assert.deepEqual(f.host.state().issues[0]!.labels, []);
  await assert.rejects(fs.stat(join(f.root, "launches")), { code: "ENOENT" });
});

test("issue read failures warn and do not prevent independent candidates", async (t) => {
  const f = await setup(t, [block()], [issue(9), issue(10)]);
  const view = f.host.viewIssue.bind(f.host);
  f.host.viewIssue = async (n) => {
    if (n === 9) throw new Error("read failed");
    return view(n);
  };
  assert.deepEqual(await f.run(), [
    { issue: 10, status: "ready", applied: true },
  ]);
  assert.match(f.stderr.join("\n"), /9.*read failed/);
});

for (const mode of ["failed", "timeout", "cancelled"] as const) {
  test(`${mode} session cannot apply even a valid result`, async (t) => {
    const f = await setup(t, []);
    const script = join(f.root, "stop.mjs");
    await fs.writeFile(
      script,
      `console.log(${JSON.stringify(block())});${mode === "failed" ? "process.exitCode=1;" : "setInterval(()=>{},1000);"}`,
    );
    f.deps.piCommand.argsPrefix = [script];
    if (mode === "timeout") f.config.pi.timeoutMinutes = 0.001;
    const controller = new AbortController();
    if (mode === "cancelled") {
      const timer = setTimeout(() => controller.abort(), 150);
      t.after(() => clearTimeout(timer));
    }
    assert.deepEqual(await f.run({ signal: controller.signal }), []);
    assert.deepEqual(f.host.state().issues[0]!.labels, []);
    assert.deepEqual(f.host.state().issues[0]!.comments, []);
    assert.match(f.stderr.join("\n"), /9/);
  });
}

for (const login of ["work", ""]) {
  test(`runtime triage trusts authenticated identity, not Tea selector ${JSON.stringify(login)}`, async (t) => {
    const people = ["alice", "work", "reviewer"];
    const f = await setup(
      t,
      [block(), block()],
      people.map((author, n) => ({
        ...issue(n + 1, ["needs-info"]),
        comments: [comment(author, "2026-10-16")],
      })),
    );
    f.config.host = {
      provider: "forgejo-tea",
      login,
      trustedAuthors: ["reviewer"],
    };
    f.host.checkCli = async () => ({
      ok: true,
      message: "authenticated",
      login: "alice",
    });
    assert.deepEqual(
      (await f.run()).map((o) => o.issue),
      [1, 3],
    );
    const launches = (await fs.readFile(join(f.root, "launches"), "utf8"))
      .trim()
      .split("\n");
    const prompt = await fs.readFile(
      JSON.parse(launches[0]!).args.at(-1).slice(1),
      "utf8",
    );
    assert.match(prompt, /alice \(trusted,/);
  });
}

test("kernel needs-info is not a trusted reply, but a genuine reply from the same account is", async (t) => {
  const f = await setup(t, [block("needs-info", "What is missing?"), block()]);
  await f.run();
  assert.equal(f.host.state().issues[0]!.comments[0]!.author, "owner");
  assert.deepEqual(await f.run(), []);
  await f.host.commentIssue(9, "Here is the answer.");
  assert.equal((await f.run()).length, 1);
  assert.equal(
    (await fs.readFile(join(f.root, "launches"), "utf8")).trim().split("\n")
      .length,
    2,
  );
});

for (const stale of [
  "closed",
  "in-progress",
  "agent-done",
  "ready",
  "needs-info+in-progress",
]) {
  test(`automatic triage skips freshly ${stale} candidate without Pi or writes`, async (t) => {
    const f = await setup(t, [block(), block()], [issue(9), issue(10)]);
    const view = f.host.viewIssue.bind(f.host);
    f.host.viewIssue = async (n) => {
      if (n === 10) {
        const state = f.host.state();
        const target = state.issues[1]!;
        if (stale === "closed") target.state = "closed";
        else
          target.labels =
            stale === "ready" ? ["agent-ready"] : stale.split("+");
        target.comments = [comment("owner", "2026-10-16")];
        writeFakeHostState(join(f.root, "host.json"), state);
      }
      return view(n);
    };
    assert.deepEqual(
      (await f.run()).map((o) => o.issue),
      [9],
    );
    assert.equal(
      f.host
        .state()
        .calls.some((c) => /(?:setLabels|commentIssue):10$/.test(c)),
      false,
    );
    assert.equal(
      (await fs.readFile(join(f.root, "launches"), "utf8")).trim().split("\n")
        .length,
      1,
    );
  });
}

test("GitHub runtime triage retains configured identity alongside authenticated identity", async (t) => {
  const f = await setup(
    t,
    [block(), block(), block()],
    ["alice", "old-owner", "reviewer"].map((author, n) => ({
      ...issue(n + 1, ["needs-info"]),
      comments: [comment(author, "2026-10-16")],
    })),
  );
  f.config.host = {
    provider: "github-gh",
    login: "old-owner",
    trustedAuthors: ["reviewer"],
  };
  f.host.checkCli = async () => ({
    ok: true,
    message: "authenticated",
    login: "alice",
  });
  assert.deepEqual(
    (await f.run()).map((o) => o.issue),
    [1, 2, 3],
  );
});

// Stale, untrusted, and Patchmill comments must not reopen needsInfo work.
test("hasReply needs a trusted, non-Patchmill comment after the status", () => {
  const tracked = {
    ...issue(9),
    status: "needsInfo" as const,
    comments: [{ ...comment("owner", "2026-10-03"), fromPatchmill: true }],
  };
  assert.equal(hasReply(tracked, ["owner"]), false);
  tracked.comments[0]!.fromPatchmill = false;
  assert.equal(hasReply(tracked, ["other"]), false);
  assert.equal(hasReply(tracked, ["owner"]), true);
  assert.equal(
    hasReply({ ...tracked, statusSince: "2026-10-04" }, ["owner"]),
    false,
  );
  assert.equal(
    hasReply({ ...tracked, statusSince: "2026-10-03" }, ["owner"]),
    false,
  );
  assert.equal(hasReply({ ...tracked, comments: [] }, ["owner"]), false);
});

test("a failed triage comment after the swap warns and counts", async (t) => {
  const f = await setup(t, [block()]);
  f.host.commentIssue = async () => {
    throw new Error("comment denied");
  };
  assert.deepEqual(await f.run(), [
    { issue: 9, status: "ready", applied: true },
  ]);
  assert.deepEqual(f.host.state().issues[0]!.labels, ["agent-ready"]);
  assert.match(f.stderr.join("\n"), /Comment failed: comment denied/);
});
