import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseRoute,
  presentationFor,
  createDraftStore,
} from "../../web/state.js";
import { createPageController } from "../../web/controller.js";
import { ApiRequestError } from "../../web/api.js";
import { createSampleRunDataSource } from "./sample-data.ts";
import type { BoardResponse, IssueResponse } from "./api-types.ts";
import type { PageState } from "../../web/controller.js";
test("routing, per-issue drafts, and controls follow every sample state", async () => {
  const s = await createSampleRunDataSource().snapshot();
  const expected: Record<number, [string | null, string, boolean]> = {
    206: ["start", "disabled", false],
    250: ["pause", "enabled", true],
    227: ["pause", "enabled", false],
    901: ["resume", "disabled", false],
    210: ["pause", "enabled", false],
    276: ["pause", "enabled", true],
    263: ["terminal", "terminal", false],
    231: [null, "finished", false],
    247: ["retry", "disabled", false],
  };
  for (const [number, want] of Object.entries(expected)) {
    const p = presentationFor(s.details[number]!.summary);
    assert.deepEqual([p.header, p.composer, p.stopReply], want);
  }
  const drafts = createDraftStore();
  drafts.set(250, "mine");
  assert.equal(drafts.get(227), "");
  assert.equal(drafts.get(250), "mine");
  assert.deepEqual(parseRoute("#/issue/227?artifact=spec"), {
    view: "issue",
    number: 227,
    artifactId: "spec",
  });
  assert.deepEqual(parseRoute("#/issue/1e2"), { view: "not-found" });
});
test("stale successes cannot replace a newer issue or restore data after auth loss", async () => {
  const s = await createSampleRunDataSource().snapshot();
  const meta = {
    schemaVersion: 1 as const,
    source: s.source,
    repository: s.repository,
    revision: s.revision,
    syncedAt: s.syncedAt,
  };
  const resolvers = new Map<number, (value: IssueResponse) => void>();
  let state: PageState | undefined;
  const c = createPageController({
    api: {
      board: async () => ({ ...meta, issues: s.issues }),
      issue: (number) =>
        new Promise((resolve) => resolvers.set(number, resolve)),
    },
    onState: (value) => (state = value),
    visible: () => true,
    clock: { after: () => () => {} },
  });
  const a = c.navigate({ view: "issue", number: 227, artifactId: null }),
    b = c.navigate({ view: "issue", number: 250, artifactId: null });
  resolvers.get(250)!({ ...meta, issue: s.details["250"]! });
  await b;
  resolvers.get(227)!({ ...meta, issue: s.details["227"]! });
  await a;
  assert.equal(state?.issue?.issue.summary.number, 250);
  let resolveBoard!: (value: BoardResponse) => void;
  const d = createPageController({
    api: {
      board: () => new Promise((resolve) => (resolveBoard = resolve)),
      issue: async () => {
        throw new ApiRequestError(401);
      },
    },
    onState: (value) => (state = value),
    visible: () => true,
    clock: { after: () => () => {} },
  });
  const pending = d.navigate({ view: "board" });
  await d.navigate({ view: "issue", number: 227, artifactId: null });
  resolveBoard({ ...meta, issues: s.issues });
  await pending;
  assert.equal(state?.status, "unauthorized");
  assert.equal(state?.board, null);
  c.dispose();
  d.dispose();
});
test("board polling stops while hidden, resumes once, and disposes its timer", async () => {
  const s = await createSampleRunDataSource().snapshot();
  let calls = 0,
    visible = true;
  let job: (() => void) | null = null;
  const c = createPageController({
    api: {
      board: async () => {
        calls++;
        return {
          schemaVersion: 1,
          source: s.source,
          repository: s.repository,
          revision: s.revision,
          syncedAt: null,
          issues: s.issues,
        };
      },
      issue: async () => assert.fail(),
    },
    onState: () => {},
    visible: () => visible,
    clock: {
      after: (ms, fn) => {
        assert.equal(ms, 15000);
        job = fn;
        return () => (job = null);
      },
    },
  });
  await c.navigate({ view: "board" });
  assert.equal(calls, 1);
  assert.ok(job);
  visible = false;
  c.visibilityChanged();
  assert.equal(job, null);
  visible = true;
  c.visibilityChanged();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.ok(job);
  c.dispose();
  assert.equal(job, null);
});
