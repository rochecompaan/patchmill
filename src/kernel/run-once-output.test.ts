import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import {
  setupRun,
  spec,
  plan,
  done,
} from "../../test-support/run-once-fixture.ts";

test("dry-run shows the selected issue, workspace and next phase without raw JSON", async (t) => {
  const c = await setupRun(t);
  await c.run({ dryRun: true });
  const text = c.output.join("\n");
  assert.match(text, /Final result:.*Dry run/);
  assert.match(text, /Issue:\s+#9/);
  assert.match(text, /Title:\s+Add login/);
  assert.match(text, /Branch:\s+agent\/issue-9-add-login/);
  assert.ok(text.replace(/\n */g, "").includes(c.worktree));
  assert.match(text, /Next phase:\s+planning/);
  assert.doesNotMatch(text, /"derived"|"kind"/);
  await assert.rejects(fs.stat(c.lockPath), { code: "ENOENT" });
});

test("live planning shows progress and one readable result while raw output stays in logs", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "design" },
      commit: "Spec",
      push: true,
      pullRequest: { draft: true, body: "Refs #9" },
      stdout: "Agent narrative only for the log",
      stderr: "Agent diagnostic only for the log",
      result: done,
    },
  ]);
  await c.run();
  const text = c.output.join("\n");
  const { dir } = await c.records();
  assert.match(text, /issue #9 · Add login/);
  assert.match(text, /01 planning/);
  assert.match(text, /tokens: task.*total.*time elapsed:/);
  assert.match(text, /Final result:.*Specification approval required/);
  assert.match(text, /Issue:\s+#9/);
  assert.match(text, /spec-review/);
  assert.ok(text.includes(spec));
  assert.ok(text.includes("https://example.invalid/pulls/1"));
  const unwrapped = text.replace(/\n */g, "");
  assert.ok(unwrapped.includes(`${dir}/pi.log`));
  assert.ok(unwrapped.includes(`${dir}/sessions`));
  assert.match(text, /Cost: 100 in \/ 20 out tokens, \$0.05/);
  assert.equal(text.split(done.summary).length - 1, 1);
  assert.doesNotMatch(
    text,
    /```json|"status"|Agent narrative|Agent diagnostic/,
  );
  const log = await fs.readFile(`${dir}/pi.log`, "utf8");
  assert.match(log, /Agent narrative only for the log/);
  assert.match(log, /Agent diagnostic only for the log/);
  assert.ok(log.includes(JSON.stringify(done)));
});

test("each phase is visible and implementation produces one final ready-PR result", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [plan]: "plan" },
      commit: "Plan",
      push: true,
      result: { status: "done", summary: "Plan prepared" },
    },
    { pullRequest: { draft: false, body: "Closes #9" }, result: done },
  ]);
  await c.seed({ [spec]: "design" });
  await c.mutate((s) => s.issues[0]!.labels.push("spec-approved"));
  assert.equal((await c.run()).status, "completed");
  const text = c.output.join("\n");
  assert.match(text, /01 planning/);
  assert.match(text, /02 implementation/);
  assert.match(text, /Final result:.*PR ready/);
  assert.match(text, /agent-done/);
  assert.equal(text.split("Final result:").length - 1, 1);
  assert.match(text, /Cost: 200 in \/ 40 out tokens, \$0.10/);
});

test("no eligible issue has a readable result instead of silent success", async (t) => {
  const c = await setupRun(t);
  await c.mutate((s) => (s.issues[0]!.labels = []));
  assert.equal((await c.run()).status, "no-work");
  assert.match(c.output.join("\n"), /Final result:.*No eligible issue/);
});
