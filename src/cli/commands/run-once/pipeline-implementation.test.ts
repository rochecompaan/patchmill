import test from "node:test";
import assert from "node:assert/strict";
import { runPipelineImplementationStage } from "./pipeline-implementation.ts";

test("runPipelineImplementationStage is exported as the implementation-stage entrypoint", () => {
  assert.equal(typeof runPipelineImplementationStage, "function");
});
