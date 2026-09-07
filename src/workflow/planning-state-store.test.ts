import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  acquirePlanningIssueLock,
  releasePlanningIssueLock,
} from "./planning-issue-lock.ts";
import {
  PlanningStateValidationError,
  createPlanningState,
} from "./planning-state.ts";
import {
  PlanningStateConflictError,
  PlanningStateStore,
} from "./planning-state-store.ts";
const runId = "123e4567-e89b-42d3-a456-426614174000";
test("initializes and atomically replaces canonical planning state under owner lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-store-"));
  try {
    const store = new PlanningStateStore(dir);
    const state = createPlanningState({
      issueNumber: 187,
      issueTitle: "Example",
      gates: { specRequired: false, planRequired: false },
      runId,
      now: "2026-09-07T12:00:00.000Z",
    });
    const lock = await acquirePlanningIssueLock(dir, {
      issueNumber: 187,
      runId,
    });
    await store.initialize({ state, lock });
    assert.equal((await stat(store.path(187))).mode & 0o777, 0o600);
    assert.match(await readFile(store.path(187), "utf8"), /\n$/);
    const next = {
      ...state,
      revision: 1,
      updatedAt: "2026-09-07T12:00:01.000Z",
    };
    assert.deepEqual(
      await store.replace({
        issueNumber: 187,
        expectedRunId: runId,
        expectedRevision: 0,
        next,
        lock,
      }),
      next,
    );
    await releasePlanningIssueLock(lock);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("malformed reads fail closed with the canonical state path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-store-"));
  try {
    const store = new PlanningStateStore(dir);
    const path = store.path(187);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{secret malformed bytes");
    await assert.rejects(
      store.read(187),
      (error: unknown) =>
        error instanceof PlanningStateValidationError &&
        error.reason === "invalid-json" &&
        error.path === "$" &&
        error.statePath === path &&
        !error.message.includes("secret"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("replacement conflicts preserve the previous canonical bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-store-"));
  try {
    const store = new PlanningStateStore(dir);
    const state = createPlanningState({
      issueNumber: 187,
      issueTitle: "Example",
      gates: { specRequired: false, planRequired: false },
      runId,
      now: "2026-09-07T12:00:00.000Z",
    });
    const lock = await acquirePlanningIssueLock(dir, {
      issueNumber: 187,
      runId,
    });
    await store.initialize({ state, lock });
    const previous = await readFile(store.path(187), "utf8");
    const next = {
      ...state,
      revision: 1,
      updatedAt: "2026-09-07T12:00:01.000Z",
    };
    for (const attempt of [
      {
        expectedRunId: "123e4567-e89b-42d3-a456-426614174099",
        expectedRevision: 0,
        reason: "run-id-mismatch",
      },
      {
        expectedRunId: runId,
        expectedRevision: 1,
        reason: "revision-mismatch",
      },
    ]) {
      await assert.rejects(
        store.replace({
          issueNumber: 187,
          expectedRunId: attempt.expectedRunId,
          expectedRevision: attempt.expectedRevision,
          next,
          lock,
        }),
        (error: unknown) =>
          error instanceof PlanningStateConflictError &&
          error.reason === attempt.reason,
      );
      assert.equal(await readFile(store.path(187), "utf8"), previous);
    }
    const wrongIssueLock = await acquirePlanningIssueLock(dir, {
      issueNumber: 188,
      runId,
    });
    await assert.rejects(
      store.replace({
        issueNumber: 187,
        expectedRunId: runId,
        expectedRevision: 0,
        next,
        lock: wrongIssueLock,
      }),
      (error: unknown) =>
        error instanceof PlanningStateConflictError &&
        error.reason === "lock-path-mismatch",
    );
    assert.equal(await readFile(store.path(187), "utf8"), previous);
    await releasePlanningIssueLock(wrongIssueLock);
    await releasePlanningIssueLock(lock);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pre-rename interruption preserves previous complete state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-store-"));
  try {
    const normal = new PlanningStateStore(dir);
    const state = createPlanningState({
      issueNumber: 187,
      issueTitle: "Example",
      gates: { specRequired: false, planRequired: false },
      runId,
      now: "2026-09-07T12:00:00.000Z",
    });
    const lock = await acquirePlanningIssueLock(dir, {
      issueNumber: 187,
      runId,
    });
    await normal.initialize({ state, lock });
    const broken = new PlanningStateStore(dir, {
      beforeRename: async () => {
        throw new Error("injected interruption");
      },
    });
    await assert.rejects(
      broken.replace({
        issueNumber: 187,
        expectedRunId: runId,
        expectedRevision: 0,
        next: { ...state, revision: 1, updatedAt: "2026-09-07T12:00:01.000Z" },
        lock,
      }),
      /injected interruption/,
    );
    assert.deepEqual(await normal.read(187), state);
    assert.deepEqual(
      (await readdir(dirname(normal.path(187)))).filter((name) =>
        name.endsWith(".tmp"),
      ),
      [],
    );
    await releasePlanningIssueLock(lock);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
