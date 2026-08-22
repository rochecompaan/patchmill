import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exitCodeForRunOnceResult,
  writeRunOnceResult,
} from "./result-output.ts";
import type { RunOnceResultSummary } from "./result-summary.ts";

const summary: RunOnceResultSummary = {
  status: "pr-created",
  issueNumber: 174,
  planPath: "docs/plans/plan.md",
  branch: "agent/issue-174",
  prUrl: "https://example.test/pulls/174",
  worktreePath: ".worktrees/issue-174",
  commits: ["abc123"],
  validation: ["npm test passed"],
};
test("writes human TTY output but exact compact JSON when redirected", async () => {
  const interactive: string[] = [];
  await writeRunOnceResult(summary, {
    stdout: {
      isTTY: true,
      columns: 80,
      write: (chunk) => interactive.push(String(chunk)),
    },
    env: { TERM: "xterm" },
  });
  assert.match(interactive.join(""), /Final result:.*PR created/u);
  assert.match(interactive.join(""), /\u001b\[/u);
  const redirected: string[] = [];
  await writeRunOnceResult(summary, {
    stdout: { isTTY: false, write: (chunk) => redirected.push(String(chunk)) },
    env: { TERM: "xterm" },
  });
  assert.equal(redirected.join(""), `${JSON.stringify(summary)}\n`);
});
test("persists structured result before stdout and maps exit status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-result-"));
  const path = join(dir, "run.jsonl");
  const output: string[] = [];
  await writeRunOnceResult(summary, {
    stdout: { isTTY: false, write: (chunk) => output.push(String(chunk)) },
    env: {},
    logPath: path,
    time: new Date("2026-08-22T11:00:00.000Z"),
  });
  const event = JSON.parse((await readFile(path, "utf8")).trim());
  assert.deepEqual(event.data, summary);
  assert.equal(event.stage, "result");
  assert.equal(event.level, "info");
  assert.equal(exitCodeForRunOnceResult(summary), 0);
  assert.equal(
    exitCodeForRunOnceResult({
      status: "blocked",
      issueNumber: 1,
      reason: "no",
      questions: [],
    }),
    1,
  );
});
