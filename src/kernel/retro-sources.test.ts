import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  collectRetroSources,
  renderRetroSourceMap,
  type RetroSource,
} from "./retro-sources.ts";

const RUN = "20261124-101500-aaaa";
const OTHER = "20261125-101500-bbbb";
const CHILD_ID = "1f9c0e12-c1a7-4227-bab3-6056f645aca6";
const since = "2026-11-24T08:15:00.000Z";

async function issueDir(t: TestContext) {
  const dir = await fs.mkdtemp(join(tmpdir(), "retro-sources-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function put(path: string, content: string) {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, content);
}

const assistant = (id: string, input: number, model = "claude-opus-5-5") =>
  JSON.stringify({
    id,
    type: "message",
    message: {
      role: "assistant",
      model,
      usage: { input, output: 10, cost: { total: 0.01 } },
    },
  });

/** A parent `subagent` tool result that names a child session file. */
const subagentResult = (id: string, sessionFile: string) =>
  JSON.stringify({
    id,
    type: "message",
    message: {
      role: "toolResult",
      toolName: "subagent",
      details: {
        results: [
          {
            agent: "reviewer",
            model: "claude-bridge/claude-opus-5-5:high",
            sessionFile,
            usage: { input: 500, output: 50, cost: 0.5 },
          },
        ],
      },
    },
  });

async function runAttempt(dir: string, runId = RUN) {
  const run = join(dir, runId);
  await put(join(run, "prompt.md"), "prompt");
  await put(join(run, "result.json"), "{}");
  await put(join(run, "history.jsonl"), "{}\n");
  await put(join(run, "session-1.log"), "log");
  await put(join(run, "notes.txt"), "not a run record");
  const child = join(run, "sessions", "1", CHILD_ID, "run-0", "session.jsonl");
  await put(child, `${assistant("c1", 500)}\n`);
  await put(
    join(run, "sessions", "1", "phase.jsonl"),
    [assistant("p1", 1000), subagentResult("p2", child)].join("\n"),
  );
  await put(
    join(
      run,
      "sessions",
      "1",
      "subagent-artifacts",
      `${CHILD_ID}_reviewer_0_output.md`,
    ),
    "findings",
  );
  await put(
    join(
      run,
      "sessions",
      "1",
      "subagent-artifacts",
      "9c0c1bba-01aa-429e-ae9e-fc57fc52a58f_patchmill-implementation_transcript.jsonl",
    ),
    `${assistant("t1", 200)}\n`,
  );
  return { run, child };
}

const byName = (sources: RetroSource[], name: string) =>
  sources.find((source) => source.path.endsWith(name));

test("lists phase sessions, subagent artifacts and run records of covered attempts", async (t) => {
  const dir = await issueDir(t);
  await runAttempt(dir);
  const sources = await collectRetroSources({ runIds: [RUN], since }, dir);
  for (const name of [
    "prompt.md",
    "result.json",
    "history.jsonl",
    "session-1.log",
  ])
    assert.equal(byName(sources, `${RUN}/${name}`)?.role, "run-record", name);
  assert.equal(byName(sources, "notes.txt"), undefined);
  const phase = byName(sources, "phase.jsonl");
  assert.equal(phase?.role, "phase");
  assert.equal(phase?.runId, RUN);
  assert.equal(phase?.session, 1);
  const output = byName(sources, "_reviewer_0_output.md");
  assert.equal(output?.role, "subagent");
  assert.equal(output?.agent, "reviewer");
  assert.equal(
    byName(sources, "_patchmill-implementation_transcript.jsonl")?.agent,
    "patchmill-implementation",
  );
});

test("skips run folders that the scope does not cover", async (t) => {
  const dir = await issueDir(t);
  await runAttempt(dir);
  await runAttempt(dir, OTHER);
  const sources = await collectRetroSources({ runIds: [OTHER], since }, dir);
  assert.ok(sources.length > 0);
  assert.ok(sources.every((source) => !source.path.includes(RUN)));
});

test("lists Console files changed at or after since, and no older ones", async (t) => {
  const dir = await issueDir(t);
  const fresh = join(dir, "console", "fresh.jsonl");
  const old = join(dir, "console", "old.jsonl");
  await put(fresh, `${assistant("f", 10)}\n`);
  await put(old, `${assistant("o", 10)}\n`);
  const before = new Date("2026-11-20T00:00:00Z");
  await fs.utimes(old, before, before);
  const sources = await collectRetroSources({ runIds: [], since }, dir);
  assert.equal(byName(sources, "fresh.jsonl")?.role, "console");
  assert.equal(byName(sources, "old.jsonl"), undefined);
});

test("gives each file its own usage, its first model, and its parent", async (t) => {
  const dir = await issueDir(t);
  const { child } = await runAttempt(dir);
  const sources = await collectRetroSources({ runIds: [RUN], since }, dir);
  const phase = byName(sources, "phase.jsonl");
  // The child record in the parent's tool result counts in the child file.
  assert.equal(phase?.usage?.inputTokens, 1000);
  assert.equal(phase?.model, "claude-opus-5-5");
  const childSource = byName(sources, "run-0/session.jsonl");
  assert.equal(childSource?.role, "subagent");
  assert.equal(childSource?.usage?.inputTokens, 500);
  assert.equal(childSource?.parent, phase?.path);
  // The child session folder is named by the reviewer artifact ID.
  assert.equal(childSource?.agent, "reviewer");
  assert.equal(childSource?.path, child);
});

test("lists an unparsable file without usage and keeps the others", async (t) => {
  const dir = await issueDir(t);
  await runAttempt(dir);
  await put(join(dir, RUN, "sessions", "2", "broken.jsonl"), "{\n");
  const sources = await collectRetroSources({ runIds: [RUN], since }, dir);
  const broken = byName(sources, "broken.jsonl");
  assert.equal(broken?.unreadable, true);
  assert.equal(broken?.usage, undefined);
  assert.equal(broken?.bytes, 2);
  assert.equal(byName(sources, "phase.jsonl")?.usage?.inputTokens, 1000);
});

test("never lists files below retros/", async (t) => {
  const dir = await issueDir(t);
  await runAttempt(dir);
  await put(
    join(dir, "retros", "r1", "sessions", "retro.jsonl"),
    `${assistant("r", 1)}\n`,
  );
  await put(join(dir, "retros", "r1", "findings.md"), "none");
  const sources = await collectRetroSources(
    { runIds: [RUN, "retros"], since },
    dir,
  );
  assert.ok(sources.every((source) => !source.path.includes("/retros/")));
});

test("renders a table grouped by Run attempt, largest input first, with since", async (t) => {
  const dir = await issueDir(t);
  await runAttempt(dir);
  await put(join(dir, "console", "main.jsonl"), `${assistant("m", 7)}\n`);
  const sources = await collectRetroSources({ runIds: [RUN], since }, dir);
  const map = renderRetroSourceMap(sources, { issueDir: dir, since });
  assert.match(map, new RegExp(`Covered since: ${since}`));
  const run = map.indexOf(`### Run attempt ${RUN}`);
  const consoleGroup = map.indexOf("### Console session");
  assert.ok(run !== -1 && consoleGroup > run);
  const phase = map.indexOf("`20261124-101500-aaaa/sessions/1/phase.jsonl`");
  const child = map.indexOf("run-0/session.jsonl` |");
  assert.ok(phase !== -1 && child > phase, "largest input first");
  assert.match(map, /\| phase \| 1 \| {2}\| claude-opus-5-5 \| 1,000 \| 10 \|/);
  assert.match(map, /`console\/main.jsonl`/);
});
