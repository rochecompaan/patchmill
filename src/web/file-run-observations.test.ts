import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { boardIssue, boardProgress } from "../../test-support/board-fixture.ts";
import { DEFAULT_CONFIG } from "../config/config.ts";
import { acquireLock } from "../kernel/lock.ts";
import { writeRunProgress } from "../kernel/run-progress.ts";
import { StateStore } from "../state/store.ts";
import {
  readIssueObservation,
  readWorkflowRoles,
} from "./file-run-observations.ts";

async function fixture(t: import("node:test").TestContext) {
  const repoRoot = await fs.mkdtemp(join(tmpdir(), "patchmill-board-files-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const config = structuredClone(DEFAULT_CONFIG);
  config.paths.runsDir = "custom-runs";
  const dir = join(repoRoot, "custom-runs/issue-9");
  const warnings: string[] = [];
  return {
    repoRoot,
    config,
    dir,
    warnings,
    read: () =>
      readIssueObservation({
        repoRoot,
        config,
        issue: 9,
        warn: (s) => warnings.push(s),
      }),
  };
}

test("file observations follow ownership and reject stale attempt phases", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.read()).state, null);
  const lock = await acquireLock(join(f.dir, "lock"), {
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
  t.after(() => lock.release());
  await writeRunProgress(
    f.dir,
    boardProgress({ state: "implementation", phase: "implementation" }),
  );
  assert.equal((await f.read()).live, true);
  assert.equal((await f.read()).state, "implementation");
  await lock.release();
  assert.equal((await f.read()).live, false);
  assert.equal((await f.read()).incomplete, true);
  const newer = await acquireLock(join(f.dir, "lock"), {
    now: () => new Date("2026-11-14T13:00:00Z"),
  });
  t.after(() => newer.release());
  assert.equal((await f.read()).state, null);
  assert.equal((await f.read()).incomplete, false);
});

test("newer current-format results beat old progress and damaged records are optional", async (t) => {
  const f = await fixture(t);
  await writeRunProgress(f.dir, boardProgress());
  const id = "20261114-130000-abcd";
  await fs.mkdir(join(f.dir, id));
  await fs.writeFile(
    join(f.dir, id, "result.json"),
    JSON.stringify({
      issue: 9,
      runId: id,
      startedAt: "2026-11-14T13:00:00Z",
      finishedAt: "2026-11-14T13:01:00Z",
      outcome: { status: "completed", issue: 9 },
      sessions: [{ phase: "implementation" }],
    }),
  );
  await fs.mkdir(join(f.dir, "console"));
  await fs.writeFile(
    join(f.dir, "console/result.json"),
    "private invalid data",
  );
  const latest = await f.read();
  assert.equal(latest.state, "ended");
  assert.equal(latest.outcomeRole, "done");
  assert.equal(latest.incomplete, false);
  await fs.writeFile(join(f.dir, "progress.json"), "damaged");
  assert.equal((await f.read()).outcomeRole, "done");
  await fs.writeFile(
    join(f.dir, id, "result.json"),
    JSON.stringify({ issue: 10 }),
  );
  assert.equal((await f.read()).state, null);
  assert.ok(f.warnings.length > 0);
});

test("configured and local workflow roles replace literal legacy policy", async (t) => {
  const f = await fixture(t);
  const store = new StateStore(join(f.repoRoot, "state"));
  f.config.labels = {
    ready: "queue",
    inProgress: "busy",
    needsInfo: "question",
    done: "delivered",
    unsuitable: "manual",
  };
  for (const [role, label] of Object.entries(f.config.labels))
    assert.deepEqual(
      await readWorkflowRoles(boardIssue(9, [label]), {
        config: f.config,
        store,
      }),
      [role],
    );
  assert.deepEqual(
    await readWorkflowRoles(
      boardIssue(9, ["blocked", "spec-review", "agent-ready"]),
      { config: f.config, store },
    ),
    [],
  );
  f.config.labels.ready = "blocked";
  assert.deepEqual(
    await readWorkflowRoles(boardIssue(9, ["blocked"]), {
      config: f.config,
      store,
    }),
    ["ready"],
  );
  f.config.workflow.stateTracking = "local";
  await store.appendStatus(9, { at: "2026-11-14T12:00:00Z", status: "done" });
  assert.deepEqual(
    await readWorkflowRoles(boardIssue(9, ["manual"]), {
      config: f.config,
      store,
    }),
    ["done"],
  );
});
