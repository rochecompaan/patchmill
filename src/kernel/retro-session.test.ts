import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { FakeHost, writeFakeHostState } from "../../test-support/fake-host.ts";
import { parseConfig, type RetroMode } from "../config/config.ts";
import type { HostProviderId } from "../host/types.ts";
import type { RetroEnd } from "./retro-record.ts";
import { runUnattendedRetro } from "./retro-session.ts";

const RUN = "20261124-101500-aaaa";
const end: RetroEnd = { kind: "merged", pullRequest: 41 };
const done = '```json\n{"status":"done","summary":"Wrote findings."}\n```';

/** A fake Pi: each launch prints the next output and exits with its code. */
async function fakePi(
  root: string,
  outputs: { stdout: string; code?: number }[],
) {
  const script = join(root, "pi.mjs");
  await fs.writeFile(
    script,
    `import fs from 'node:fs';
const root=${JSON.stringify(root)};
fs.appendFileSync(root+'/launches', JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)})+'\\n');
const outputs=${JSON.stringify(outputs)};
const count=fs.readFileSync(root+'/launches','utf8').trim().split('\\n').length;
const out=outputs[count-1]??{stdout:''};
console.log(out.stdout);
process.exitCode=out.code??0;`,
  );
  return { command: process.execPath, argsPrefix: [script] };
}

async function setup(
  t: TestContext,
  outputs: { stdout: string; code?: number }[],
  options: { mode?: RetroMode; provider?: HostProviderId } = {},
) {
  const root = await fs.mkdtemp(join(tmpdir(), "patchmill-retro-session-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = join(root, "host.json");
  writeFakeHostState(state, {
    issues: [
      {
        number: 9,
        labels: [],
        title: "Fix login",
        body: "Details",
        author: "reporter",
        state: "closed",
        url: "https://example.invalid/issues/9",
        createdAt: "2026-10-01",
        comments: [],
      },
    ],
  });
  const host = new FakeHost(state);
  const config = parseConfig({
    host: { provider: options.provider ?? "github-gh", login: "owner" },
    retro: { unattended: options.mode ?? "findings-only" },
  });
  const issueDir = join(root, ".patchmill/runs/issue-9");
  await fs.mkdir(join(issueDir, RUN, "sessions", "1"), { recursive: true });
  await fs.writeFile(
    join(issueDir, RUN, "result.json"),
    JSON.stringify({ startedAt: "2026-11-24T08:15:00.000Z" }),
  );
  await fs.writeFile(
    join(issueDir, RUN, "sessions", "1", "phase.jsonl"),
    `${JSON.stringify({ id: "a", message: { role: "assistant", usage: { input: 10, output: 1 } } })}\n`,
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps = {
    host,
    repoRoot: root,
    piCommand: await fakePi(root, outputs),
    now: () => new Date("2026-11-27T09:15:00Z"),
    output: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
  };
  const launches = async () => {
    try {
      return (await fs.readFile(join(root, "launches"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { cwd: string; args: string[] });
    } catch {
      return [];
    }
  };
  const retros = async () => {
    const dir = join(issueDir, "retros");
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    return Promise.all(
      names.map(async (name) => ({
        dir: join(dir, name),
        record: JSON.parse(
          await fs.readFile(join(dir, name, "retro.json"), "utf8"),
        ) as Record<string, unknown>,
      })),
    );
  };
  return {
    root,
    config,
    stdout,
    stderr,
    launches,
    retros,
    run: (signal?: AbortSignal) =>
      runUnattendedRetro(config, deps, {
        issue: 9,
        end,
        ...(signal ? { signal } : {}),
      }),
  };
}

test("off and an aborted signal start nothing", async (t) => {
  const off = await setup(t, [{ stdout: done }], { mode: "off" });
  await off.run();
  assert.deepEqual(await off.launches(), []);
  assert.deepEqual(await off.retros(), []);
  const aborted = await setup(t, [{ stdout: done }]);
  await aborted.run(AbortSignal.abort());
  assert.deepEqual(await aborted.launches(), []);
  assert.deepEqual(await aborted.retros(), []);
});

test("findings-only starts one session in the repo root with the retro skill", async (t) => {
  const c = await setup(t, [{ stdout: done }]);
  await c.run();
  const launches = await c.launches();
  assert.equal(launches.length, 1);
  const realRoot = await fs.realpath(c.root);
  assert.equal(await fs.realpath(launches[0]!.cwd), realRoot);
  const args = launches[0]!.args;
  assert.equal(
    args[args.indexOf("--skill") + 1],
    join(c.root, ".patchmill/skills/patchmill-retro"),
  );
  const [retro] = await c.retros();
  assert.ok(retro);
  assert.equal(retro.record.status, "done");
  assert.equal(retro.record.summary, "Wrote findings.");
  const prompt = await fs.readFile(join(retro.dir, "prompt.md"), "utf8");
  assert.match(prompt, /Mode: findings-only/);
  assert.match(prompt, /do not write to the host/);
  assert.ok(prompt.includes(join(retro.dir, "findings.md")));
  assert.match(prompt, /## Retro source map/);
  assert.ok(prompt.includes(`${RUN}/sessions/1/phase.jsonl`));
  assert.match(prompt, /Covered since: 2026-11-24T08:15:00.000Z/);
  assert.deepEqual(c.stderr, []);
  assert.ok(c.stdout.some((line) => line.startsWith("Retro: ")));
});

for (const [provider, cli] of [
  ["github-gh", "gh"],
  ["forgejo-tea", "tea"],
] as const)
  test(`file-issues names the host CLI: ${cli}`, async (t) => {
    const c = await setup(t, [{ stdout: done }], {
      mode: "file-issues",
      provider,
    });
    await c.run();
    const [retro] = await c.retros();
    const prompt = await fs.readFile(join(retro!.dir, "prompt.md"), "utf8");
    assert.match(prompt, /Mode: file-issues/);
    assert.match(prompt, new RegExp(`Use the \`${cli}\` CLI`));
    assert.match(prompt, /Filing is allowed/);
  });

for (const [name, output] of [
  ["a failing session", { stdout: done, code: 1 }],
  ["a result-less session", { stdout: "no block" }],
  [
    "a failed result",
    { stdout: '```json\n{"status":"failed","summary":"jq missing"}\n```' },
  ],
] as const)
  test(`${name} warns once and marks the Retro failed`, async (t) => {
    const c = await setup(t, [output]);
    await c.run();
    assert.equal(c.stderr.length, 1);
    assert.match(c.stderr[0]!, /^Warning: Issue #9 Retro: /);
    const [retro] = await c.retros();
    assert.equal(retro!.record.status, "failed");
  });

test("a host failure before the session warns and marks the Retro failed", async (t) => {
  const c = await setup(t, [{ stdout: done }]);
  await fs.writeFile(join(c.root, "host.json"), "{");
  await c.run();
  assert.equal(c.stderr.length, 1);
  assert.deepEqual(await c.launches(), []);
  const [retro] = await c.retros();
  assert.equal(retro!.record.status, "failed");
});

test("a second call for the same end starts nothing", async (t) => {
  const c = await setup(t, [{ stdout: done }, { stdout: done }]);
  await c.run();
  await c.run();
  assert.equal((await c.launches()).length, 1);
  assert.equal((await c.retros()).length, 1);
});
