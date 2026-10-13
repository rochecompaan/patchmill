import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createLegacyPrScenario } from "../../../../test-support/run-once/legacy-pr-scenario.ts";
import { withRunAdmission } from "../../../workflow/run-admission.ts";
import { resolveRunOnceRepositoryNamespace } from "./repository-admission.ts";
import { main } from "./main.ts";
import { runResetCommand } from "../run/reset/main.ts";

for (const command of ["run-once", "reset"] as const) {
  test(`${command} logs live admission contention as a warning without changing issue state`, async (t) => {
    const scenario = await createLegacyPrScenario();
    t.after(() => scenario.cleanup());
    const namespace = await resolveRunOnceRepositoryNamespace(
      scenario.runner,
      scenario.config,
    );
    const originalState = await scenario.raw();
    let stdout = "";
    let stderr = "";
    const out = {
      write: (chunk: string | Uint8Array) => {
        stdout += String(chunk);
        return true;
      },
    };
    const err = {
      write: (chunk: string | Uint8Array) => {
        stderr += String(chunk);
        return true;
      },
    };
    const code = await withRunAdmission(
      { namespace, mode: "automatic", attemptId: "winner" },
      async (admission) => {
        const ownerBytes = await readFile(admission.recordPath, "utf8");
        t.mock.method(process.stdout, "write", out.write);
        t.mock.method(process.stderr, "write", err.write);
        let result;
        try {
          result =
            command === "run-once"
              ? await main([], {
                  loadConfig: async () => scenario.config,
                  createRunner: () => scenario.runner,
                })
              : await runResetCommand([], {
                  loadConfig: async () => scenario.config,
                  runner: scenario.runner,
                  stdout: process.stdout,
                  stderr: process.stderr,
                });
        } finally {
          t.mock.restoreAll();
        }
        assert.equal(await readFile(admission.recordPath, "utf8"), ownerBytes);
        return result;
      },
    );
    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.status, "stopped");
    assert.equal(result.reason, "run-admission-busy");
    assert.equal(result.issueNumber, 226);
    assert.doesNotMatch(stderr, /blocked:|Unexpected error|✗/u);
    const logs = (await readdir(scenario.config.runStateDir)).filter((file) =>
      file.endsWith(".jsonl"),
    );
    assert.equal(logs.length, 1);
    const events = (
      await readFile(join(scenario.config.runStateDir, logs[0]!), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(events.every((event) => event.level !== "error"));
    assert.equal(
      events.find((event) => event.stage === "admission").level,
      "warning",
    );
    assert.equal(events.at(-1).data.status, "stopped");
    assert.equal(events.at(-1).level, "warning");
    assert.equal(await scenario.raw(), originalState);
    assert.deepEqual(scenario.effects, []);
  });
}
