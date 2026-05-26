import assert from "node:assert/strict";
import { test } from "node:test";
import { withPromptFile, type PromptFileDependencies } from "./prompt-file.ts";

function recordingDependencies(
  overrides: Partial<PromptFileDependencies> = {},
): PromptFileDependencies & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    tmpdir() {
      calls.push("tmpdir");
      return "/tmp-root";
    },
    async mkdtemp(prefix) {
      calls.push(`mkdtemp:${prefix}`);
      return "/tmp-root/agent-test-abc123";
    },
    async writeFile(path, data, encoding) {
      calls.push(`writeFile:${path}:${data}:${encoding}`);
    },
    async rm(path, options) {
      calls.push(`rm:${path}:${options.recursive}:${options.force}`);
    },
    ...overrides,
  };
}

test("withPromptFile writes a prompt, passes its path to the callback, and removes the temp dir", async () => {
  const deps = recordingDependencies();

  const result = await withPromptFile(
    "agent-test-",
    "prompt body",
    async (promptPath) => {
      deps.calls.push(`callback:${promptPath}`);
      return "ok";
    },
    deps,
  );

  assert.equal(result, "ok");
  assert.deepEqual(deps.calls, [
    "tmpdir",
    "mkdtemp:/tmp-root/agent-test-",
    "writeFile:/tmp-root/agent-test-abc123/prompt.md:prompt body:utf8",
    "callback:/tmp-root/agent-test-abc123/prompt.md",
    "rm:/tmp-root/agent-test-abc123:true:true",
  ]);
});

test("withPromptFile removes the temp dir when prompt writing fails", async () => {
  const deps = recordingDependencies({
    async writeFile(path, data, encoding) {
      deps.calls.push(`writeFile:${path}:${data}:${encoding}`);
      throw new Error("disk full");
    },
  });

  await assert.rejects(
    () =>
      withPromptFile(
        "agent-test-",
        "prompt body",
        async () => {
          assert.fail("callback should not run when prompt writing fails");
        },
        deps,
      ),
    /disk full/,
  );

  assert.deepEqual(deps.calls, [
    "tmpdir",
    "mkdtemp:/tmp-root/agent-test-",
    "writeFile:/tmp-root/agent-test-abc123/prompt.md:prompt body:utf8",
    "rm:/tmp-root/agent-test-abc123:true:true",
  ]);
});
