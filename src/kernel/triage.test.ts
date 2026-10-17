import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { FakeHost, writeFakeHostState } from "../../test-support/fake-host.ts";
import { parseConfig } from "../config/config.ts";
import type { Issue } from "../host/types.ts";
import {
  runTriage,
  selectTriageCandidates,
  type TriageOptions,
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
test("selects open unclassified issues and needs-info with the latest trusted reply", () => {
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
  assert.deepEqual(
    selectTriageCandidates(issues, labels, ["owner"]).map((i) => i.number),
    [1, 21, 23],
  );
  assert.deepEqual(
    selectTriageCandidates(
      [issue(1, ["queue"]), issue(2, ["agent-ready"])],
      { ...labels, ready: "queue" },
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
  const script = join(root, "pi.mjs");
  // Local child exercises the actual supervisor and records its launch boundary.
  await fs.writeFile(
    script,
    `import fs from 'node:fs';\nconst root=${JSON.stringify(root)};\nfs.appendFileSync(root+'/launches', JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),agentDir:process.env.PI_CODING_AGENT_DIR})+'\\n');\nconst outputs=${JSON.stringify(outputs)};\nconst count=fs.readFileSync(root+'/launches','utf8').trim().split('\\n').length;\nconsole.log(outputs[count-1]);`,
  );
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
    repoRoot: root,
    piCommand: { command: process.execPath, argsPrefix: [script] },
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
const block = (label = "agent-ready", comment = "Looks clear.") =>
  `\`\`\`json\n${JSON.stringify({ label, comment })}\n\`\`\``;

test("applies a validated result and launches isolated Pi with the configured envelope", async (t) => {
  const f = await setup(t, [block()]);
  assert.deepEqual(await f.run(), [
    { issue: 9, label: "agent-ready", applied: true },
  ]);
  assert.deepEqual(f.host.state().issues[0]!.labels, ["agent-ready"]);
  assert.match(f.host.state().issues[0]!.comments[0]!.body, /Looks clear\.$/);
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

test("dry-run still invokes Pi and prints label and comment without Host writes", async (t) => {
  const f = await setup(t, [block()]);
  const before = f.host.state().issues;
  assert.deepEqual(await f.run({ dryRun: true }), [
    { issue: 9, label: "agent-ready", applied: false },
  ]);
  assert.deepEqual(f.host.state().issues, before);
  assert.match(f.stdout.join("\n"), /agent-ready/);
  assert.match(f.stdout.join("\n"), /Looks clear\./);
  assert.equal(
    f.host.state().calls.some((c) => /setLabels|commentIssue/.test(c)),
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
      { issue: 10, label: "agent-ready", applied: true },
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
    blocked: "wait",
  };
  const set = f.host.setLabels.bind(f.host);
  f.host.setLabels = async (n, add, remove) => {
    assert.deepEqual(add, ["question"]);
    assert.deepEqual(remove.sort(), ["nope", "queue", "wait"]);
    await set(n, add, remove);
  };
  assert.deepEqual(await f.run({ issue: 9 }), [
    { issue: 9, label: "question", applied: true },
  ]);
  assert.deepEqual(f.host.state().issues[0]!.labels, [
    "question",
    "bug",
    "agent-done",
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
  assert.equal((await f.run())[0]?.label, "wontfix");
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
    { issue: 10, label: "agent-ready", applied: true },
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
