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

test("retired blocked configuration is accepted as a string but never retained", () => {
  assert.equal(
    "blocked" in parseConfig({ labels: { blocked: "old" } }).labels,
    false,
  );
  assert.throws(() => parseConfig({ labels: { blocked: false } }), ConfigError);
});

test("stateTracking defaults to labels and accepts local", () => {
  assert.equal(parseConfig({}).workflow.stateTracking, "labels");
  assert.equal(
    parseConfig({ workflow: { stateTracking: "local" } }).workflow
      .stateTracking,
    "local",
  );
});
test("stateTracking rejects other values", () => {
  assert.throws(
    () => parseConfig({ workflow: { stateTracking: "remote" } }),
    /Invalid value for workflow.stateTracking/,
  );
});

// Ambiguous outcomes must be rejected regardless of the state backend.
for (const mode of ["local", "labels"] as const) {
  for (const needsInfo of ["shared", "SHARED"]) {
    test(`${mode} rejects duplicate workflow labels (${needsInfo})`, () => {
      assert.throws(
        () =>
          parseConfig({
            workflow: { stateTracking: mode },
            labels: {
              needsInfo,
              ready: "shared",
              done: "other",
              inProgress: "other",
            },
          }),
        new ConfigError(
          'Workflow labels must be distinct: labels.ready and labels.needsInfo are both "shared".',
        ),
      );
    });
  }
}

test("cleanupHook accepts a script path or omission without allowing unknown keys", () => {
  assert.equal(
    parseConfig({ cleanupHook: "./scripts/cleanup.sh" }).cleanupHook,
    "./scripts/cleanup.sh",
  );
  assert.equal(parseConfig({}).cleanupHook, undefined);
  assert.equal(parseConfig({ cleanupHook: "" }).cleanupHook, "");
  for (const cleanupHook of [null, false, 42, [], {}]) {
    assert.throws(
      () => parseConfig({ cleanupHook }),
      new ConfigError("Invalid type for cleanupHook"),
    );
  }
  assert.throws(
    () => parseConfig({ cleanupHooks: "script.sh" }),
    new ConfigError("Unknown config key: cleanupHooks"),
  );
});

test("loadConfig validates the optional cleanupHook", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-hook-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, CONFIG_FILE),
    JSON.stringify({ cleanupHook: "./scripts/cleanup.sh" }),
  );
  assert.equal((await loadConfig(root)).cleanupHook, "./scripts/cleanup.sh");
  await writeFile(
    join(root, CONFIG_FILE),
    JSON.stringify({ cleanupHook: null }),
  );
  await assert.rejects(
    loadConfig(root),
    new ConfigError("Invalid type for cleanupHook"),
  );
});

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

test("run defaults apply when the section is absent", () => {
  assert.deepEqual(parseConfig({}).run, {
    triageIntervalMinutes: 5,
    conflictRetryMinutes: 30,
    idleBackoff: { initialSeconds: 60, maxSeconds: 900 },
    errorBackoff: { initialSeconds: 30, maxSeconds: 1800 },
  });
});

test("run accepts partial overrides", () => {
  assert.deepEqual(
    parseConfig({ run: { idleBackoff: { maxSeconds: 120 } } }).run.idleBackoff,
    { initialSeconds: 60, maxSeconds: 120 },
  );
});

for (const path of [
  ["triageIntervalMinutes"],
  ["conflictRetryMinutes"],
  ["idleBackoff", "initialSeconds"],
  ["errorBackoff", "maxSeconds"],
]) {
  for (const value of [0, -1, Number.NaN]) {
    test(`run rejects ${String(value)} in run.${path.join(".")}`, () => {
      const run: Record<string, unknown> =
        path.length === 1
          ? { [path[0]!]: value }
          : { [path[0]!]: { [path[1]!]: value } };
      assert.throws(
        () => parseConfig({ run }),
        (error: unknown) =>
          error instanceof ConfigError &&
          error.message.includes(`run.${path.join(".")}`),
      );
    });
  }
}

test("run rejects a cap below its initial delay", () => {
  assert.throws(
    () =>
      parseConfig({
        run: { errorBackoff: { initialSeconds: 60, maxSeconds: 30 } },
      }),
    (error: unknown) =>
      error instanceof ConfigError &&
      /run\.errorBackoff\.maxSeconds/.test(error.message),
  );
});

test("run rejects unknown keys", () => {
  assert.throws(
    () => parseConfig({ run: { lane: 1 } }),
    /Unknown config key: run\.lane/,
  );
});

test("run rejects a wait longer than the timer limit", () => {
  // Node runs a longer timer after 1 ms, which would make backoff a tight loop.
  assert.throws(
    () => parseConfig({ run: { idleBackoff: { maxSeconds: 2_147_484 } } }),
    (error: unknown) =>
      error instanceof ConfigError &&
      /run\.idleBackoff\.maxSeconds/.test(error.message),
  );
  assert.equal(
    parseConfig({ run: { idleBackoff: { maxSeconds: 2_147_483 } } }).run
      .idleBackoff.maxSeconds,
    2_147_483,
  );
});
