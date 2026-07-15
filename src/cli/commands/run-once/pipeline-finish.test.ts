import test from "node:test";
import assert from "node:assert/strict";
import { runPipelineFinishStage } from "./pipeline-finish.ts";

test("runPipelineFinishStage returns collaborator outcome", async () => {
  const result = await runPipelineFinishStage({
    run: async () => ({ kind: "finished", result: { status: "no-issue" } }),
  });
  assert.equal(result.kind, "finished");
});
