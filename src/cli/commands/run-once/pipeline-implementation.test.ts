import test from "node:test";
import assert from "node:assert/strict";
import { runPipelineImplementationStage } from "./pipeline-implementation.ts";

test("runPipelineImplementationStage returns collaborator outcome", async () => {
  const result = await runPipelineImplementationStage({
    run: async () => ({
      kind: "implemented",
      result: {
        status: "pr-created",
        prUrl: "https://example/pr/1",
        branch: "agent/issue-1",
        commits: ["abc"],
        validation: ["npm test"],
      },
    }),
  });
  assert.equal(result.kind, "implemented");
});
