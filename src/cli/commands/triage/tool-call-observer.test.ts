import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runWithToolCallObservation } from "./tool-call-observer.ts";

test("runWithToolCallObservation supplies a session directory and observes legacy tool calls", async () => {
  const observed: Array<{ toolName?: string; toolCallId?: string }> = [];
  let suppliedSessionDir = "";

  const result = await runWithToolCallObservation(
    (event) =>
      observed.push({ toolName: event.toolName, toolCallId: event.toolCallId }),
    async (sessionDir) => {
      assert.ok(sessionDir);
      suppliedSessionDir = sessionDir;
      await mkdir(join(sessionDir, "child"), { recursive: true });
      await writeFile(
        join(sessionDir, "child", "session.jsonl"),
        JSON.stringify({
          type: "message",
          message: {
            role: "toolResult",
            toolName: "bash",
            toolCallId: "call-1",
          },
        }) + "\n",
        "utf8",
      );
      return "ok";
    },
  );

  assert.equal(result, "ok");
  assert.deepEqual(observed, [{ toolName: "bash", toolCallId: "call-1" }]);
  await assert.rejects(stat(suppliedSessionDir), { code: "ENOENT" });
});
