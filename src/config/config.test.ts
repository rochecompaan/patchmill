import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CONFIG_FILE,
  ConfigError,
  DEFAULT_CONFIG,
  loadConfig,
  parseConfig,
  trustedAuthors,
} from "./config.ts";

test("parseConfig fills an empty config with defaults", () => {
  assert.deepEqual(parseConfig({}), DEFAULT_CONFIG);
});

test("parseConfig overrides a nested value and retains other defaults", () => {
  assert.deepEqual(parseConfig({ pi: { timeoutMinutes: 5 } }), {
    ...DEFAULT_CONFIG,
    pi: { ...DEFAULT_CONFIG.pi, timeoutMinutes: 5 },
  });
});

for (const [path, raw] of [
  ["planning", { planning: {} }],
  ["workflow.planApproval", { workflow: { planApproval: {} } }],
  ["pi.timeoutMinutes", { pi: { timeoutMinutes: "5" } }],
  ["host.provider", { host: { provider: "gitlab" } }],
  ["host.trustedAuthors", { host: { trustedAuthors: ["alice", 3] } }],
  ["git.baseBranch", { git: { baseBranch: 12 } }],
  [
    "workflow.specApproval.required",
    { workflow: { specApproval: { required: "yes" } } },
  ],
  ["labels.ready", { labels: { ready: false } }],
  ["pi", { pi: null }],
  ["workflow.specApproval", { workflow: { specApproval: [] } }],
  ["toString", { toString: "unknown" }],
  ["host.login", { "host.login": "alice" }],
  [
    "workflow.specApproval.required",
    { workflow: { "specApproval.required": false } },
  ],
] as const) {
  test(`parseConfig rejects invalid ${path}`, () => {
    assert.throws(
      () => parseConfig(raw),
      (error) => error instanceof ConfigError && error.message.includes(path),
    );
  });
}

test("parseConfig reports only the first invalid key", () => {
  assert.throws(
    () => parseConfig({ planning: {}, other: {} }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /planning/);
      assert.doesNotMatch(error.message, /other/);
      return true;
    },
  );
});

for (const raw of [null, [], "config", 4, true, undefined]) {
  test(`parseConfig rejects non-object input ${JSON.stringify(raw)}`, () => {
    assert.throws(() => parseConfig(raw), ConfigError);
  });
}

test("parseConfig accepts nullable baseBranch and both host providers", () => {
  assert.equal(parseConfig({ git: { baseBranch: null } }).git.baseBranch, null);
  assert.equal(
    parseConfig({ git: { baseBranch: "main" } }).git.baseBranch,
    "main",
  );
  assert.equal(
    parseConfig({ host: { provider: "forgejo-tea" } }).host.provider,
    "forgejo-tea",
  );
});

test("parseConfig results do not share mutable defaults", () => {
  const config = parseConfig({});
  config.host.trustedAuthors.push("alice");
  config.labels.ready = "custom";
  assert.deepEqual(parseConfig({}).host.trustedAuthors, []);
  assert.equal(DEFAULT_CONFIG.labels.ready, "agent-ready");
});

test("trustedAuthors omits an empty login", () => {
  assert.deepEqual(
    trustedAuthors(
      parseConfig({ host: { login: "", trustedAuthors: ["alice"] } }),
    ),
    ["alice"],
  );
});

test("trustedAuthors deduplicates with login first and preserves order", () => {
  assert.deepEqual(
    trustedAuthors(
      parseConfig({
        host: {
          login: "alice",
          trustedAuthors: ["bob", "alice", "bob", "carol"],
        },
      }),
    ),
    ["alice", "bob", "carol"],
  );
});

test("loadConfig missing file directs the user to patchmill init", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    loadConfig(root),
    (error) =>
      error instanceof ConfigError && error.message.includes("patchmill init"),
  );
});

test("loadConfig reads and validates the repository config file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, CONFIG_FILE),
    JSON.stringify({ pi: { timeoutMinutes: 5 } }),
  );
  assert.equal((await loadConfig(root)).pi.timeoutMinutes, 5);
  await writeFile(join(root, CONFIG_FILE), JSON.stringify({ planning: {} }));
  await assert.rejects(
    loadConfig(root),
    (error) =>
      error instanceof ConfigError && error.message.includes("planning"),
  );
});

for (const text of ["{", "null", "[]", '"config"']) {
  test(`loadConfig rejects malformed or non-object JSON ${text}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "patchmill-config-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(join(root, CONFIG_FILE), text);
    await assert.rejects(
      loadConfig(root),
      (error) =>
        error instanceof ConfigError && error.message.includes(CONFIG_FILE),
    );
  });
}

test("Tea selector never grants author trust when authenticated identity is unavailable", () => {
  assert.deepEqual(
    trustedAuthors(
      parseConfig({
        host: {
          provider: "forgejo-tea",
          login: "work",
          trustedAuthors: ["reviewer"],
        },
      }),
    ),
    ["reviewer"],
  );
});
