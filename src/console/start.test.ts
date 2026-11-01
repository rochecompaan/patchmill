import assert from "node:assert/strict";
import { test } from "node:test";
import { setupRun } from "../../test-support/run-once-fixture.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";
import {
  collectConsoleDiagnostics,
  createStartRun,
  runConsoleRuntime,
} from "./start.ts";

for (const failure of ["service", "extension"] as const) {
  test(`${failure} startup errors prevent the TUI and dispose the runtime`, async () => {
    const diagnostics = collectConsoleDiagnostics(
      failure === "service"
        ? [{ type: "error", message: "Provider failed" }]
        : [],
      {
        errors:
          failure === "extension"
            ? [{ path: "/broken", error: "Invalid extension" }]
            : [],
      },
    );
    const output: string[] = [];
    let entered = false;
    let disposed = false;
    const code = await runConsoleRuntime(
      {
        diagnostics,
        dispose: async () => {
          disposed = true;
        },
      },
      async () => {
        entered = true;
      },
      (line) => output.push(line),
    );
    assert.equal(code, 1);
    assert.equal(entered, false);
    assert.equal(disposed, true);
    assert.deepEqual(output, [
      failure === "service"
        ? "Provider failed"
        : 'Failed to load extension "/broken": Invalid extension',
    ]);
  });
}

test("startup warnings are surfaced and the TUI continues", async () => {
  const diagnostics = collectConsoleDiagnostics(
    [{ type: "warning", message: "Provider warning" }],
    {
      errors: [],
      warnings: [{ path: "/package", warning: "Package warning" }],
    },
  );
  const events: string[] = [];
  const code = await runConsoleRuntime(
    {
      diagnostics,
      dispose: async () => {
        events.push("dispose");
      },
    },
    async () => {
      events.push("TUI");
    },
    (line) => events.push(line),
  );
  assert.equal(code, 0);
  assert.deepEqual(events, [
    "Provider warning",
    'Extension package "/package": Package warning',
    "TUI",
    "dispose",
  ]);
});

test("TUI failures still dispose the runtime", async () => {
  let disposed = false;
  await assert.rejects(
    runConsoleRuntime(
      {
        diagnostics: [],
        dispose: async () => {
          disposed = true;
        },
      },
      async () => {
        throw new Error("TUI failed");
      },
      () => {},
    ),
    /TUI failed/,
  );
  assert.equal(disposed, true);
});

test("startRun forwards the selected issue, dependencies, channel and observer and routes both streams to the human", async (t) => {
  const c = await setupRun(t, []);
  const human = fakeHuman(c);
  const observe = () => {};
  const outcome = { status: "no-work" as const };
  let entered = false;
  const startRun = createStartRun(
    c.config,
    c.deps,
    async (config, deps, options) => {
      entered = true;
      assert.equal(config, c.config);
      assert.deepEqual(options, { issue: 42 });
      assert.equal(deps.human, human);
      assert.equal(deps.observe, observe);
      for (const key of [
        "host",
        "runner",
        "git",
        "piCommand",
        "extensionPaths",
        "repoRoot",
        "now",
      ] as const)
        assert.equal(deps[key], c.deps[key]);
      deps.output.stdout("progress");
      deps.output.stderr("warning");
      return outcome;
    },
  );
  assert.equal(await startRun(42, human, observe), outcome);
  assert.equal(entered, true);
  assert.deepEqual(human.calls, ["notify:progress", "notify:warning"]);
});
