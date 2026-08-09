import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
} from "@earendil-works/pi-coding-agent";
import { findPackageRoot } from "../../package-root.ts";
import { SUBAGENT_PROGRESS_APPEND_ERROR } from "./run-once-subagent-progress.ts";

const rootDir = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

test("Pi reports append failure and a terminal event retries the tuple", async () => {
  const homeDir = mkdtempSync(join(tmpdir(), "patchmill-progress-runner-"));
  try {
    const observerPath = join(
      rootDir,
      "src",
      "pi",
      "extensions",
      "run-once-subagent-progress.ts",
    );
    const loaded = await discoverAndLoadExtensions(
      [observerPath],
      rootDir,
      join(homeDir, "agent"),
    );
    assert.deepEqual(loaded.errors, []);

    const appended: Array<{ customType: string; data: unknown }> = [];
    let failNextAppend = true;
    loaded.runtime.appendEntry = (customType, data) => {
      if (failNextAppend) {
        failNextAppend = false;
        throw new Error("unstable storage detail");
      }
      appended.push({ customType, data });
    };

    const runner = new ExtensionRunner(
      loaded.extensions,
      loaded.runtime,
      rootDir,
      { getEntries: () => [] } as never,
      {} as never,
    );
    const errors: Array<{
      extensionPath: string;
      event: string;
      error: string;
    }> = [];
    runner.onError((error) => errors.push(error));
    for (const eventName of [
      "session_start",
      "tool_execution_update",
      "tool_execution_end",
    ]) {
      assert.equal(runner.hasHandlers(eventName), true);
    }

    await runner.emit({ type: "session_start", reason: "startup" });
    await runner.emit({
      type: "tool_execution_update",
      toolName: "subagent",
      toolCallId: "call-1",
      args: {},
      partialResult: { details: { results: [{ index: 0, agent: "worker" }] } },
    });
    assert.equal(appended.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.event, "tool_execution_update");
    assert.equal(errors[0]?.error, SUBAGENT_PROGRESS_APPEND_ERROR);
    assert.match(
      errors[0]?.extensionPath ?? "",
      /run-once-subagent-progress\.ts$/u,
    );

    await runner.emit({
      type: "tool_execution_end",
      toolName: "subagent",
      toolCallId: "call-1",
      result: { details: { results: [{ index: 0, agent: "worker" }] } },
      isError: false,
    });
    assert.deepEqual(appended, [
      {
        customType: "patchmill-subagent-progress",
        data: { toolCallId: "call-1", childIndex: 0, agent: "worker" },
      },
    ]);
    assert.equal(errors.length, 1);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
