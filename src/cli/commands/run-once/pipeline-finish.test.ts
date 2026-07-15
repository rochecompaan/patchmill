import test from "node:test";
import assert from "node:assert/strict";
import { runPipelineFinishStage } from "./pipeline-finish.ts";

test("runPipelineFinishStage is exported as the finish-stage entrypoint", () => {
  assert.equal(typeof runPipelineFinishStage, "function");
});
