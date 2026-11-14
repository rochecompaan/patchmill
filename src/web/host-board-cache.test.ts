import assert from "node:assert/strict";
import { test } from "node:test";
import { boardIssue } from "../../test-support/board-fixture.ts";
import { createHostBoardCache } from "./host-board-cache.ts";
import type { Issue } from "../host/types.ts";

test("concurrent board reads share one host refresh across expiry and slow requests", async () => {
  let now = 0,
    issueCalls = 0,
    prCalls = 0;
  let resolve!: (issues: Issue[]) => void;
  const cache = createHostBoardCache({
    now: () => new Date(now),
    warn: () => {},
    host: {
      listOpenIssues: () => {
        issueCalls++;
        return new Promise((r) => {
          resolve = r;
        });
      },
      listOpenPullRequests: async () => {
        prCalls++;
        return [];
      },
    },
  });
  const first = Array.from({ length: 10 }, () => cache.read());
  assert.equal(issueCalls, 1);
  assert.equal(prCalls, 1);
  now = 100000;
  const slow = cache.read();
  assert.equal(issueCalls, 1);
  resolve([boardIssue()]);
  const values = await Promise.all([...first, slow]);
  assert.ok(values.every((v) => v.syncedAt === new Date(100000).toISOString()));
  const refresh = cache.read();
  assert.equal(issueCalls, 2);
  resolve([boardIssue(10)]);
  await refresh;
  now = 159999;
  await cache.read();
  assert.equal(issueCalls, 2);
  now = 160000;
  const expired = Promise.all([cache.read(), cache.read()]);
  assert.equal(issueCalls, 3);
  assert.equal(prCalls, 3);
  resolve([]);
  await expired;
});

test("a rejected host operation retains refresh ownership until its pending sibling settles", async () => {
  let now = 0,
    calls = 0,
    settled = false;
  let release!: (value: []) => void;
  const cache = createHostBoardCache({
    now: () => new Date(now),
    warn: () => {},
    host: {
      listOpenIssues: async () => {
        throw Error("issues failed");
      },
      listOpenPullRequests: () => {
        calls++;
        return new Promise<[]>((resolve) => {
          release = resolve;
        });
      },
    },
  });
  const pending = cache.read();
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  now = 60000;
  assert.equal(cache.read(), pending);
  assert.equal(calls, 1);
  release([]);
  await assert.rejects(pending);
});

test("failed attempts consume the period and preserve last successful host timestamps", async () => {
  let now = 0,
    calls = 0,
    fail = true;
  const cache = createHostBoardCache({
    now: () => new Date(now),
    warn: () => {},
    host: {
      listOpenIssues: async () => {
        calls++;
        if (fail) throw Error("host private error");
        return [boardIssue()];
      },
      listOpenPullRequests: async () => [],
    },
  });
  await assert.rejects(cache.read());
  now = 59999;
  await assert.rejects(cache.read());
  assert.equal(calls, 1);
  now = 60000;
  fail = false;
  const saved = await cache.read();
  assert.equal(calls, 2);
  now = 120000;
  fail = true;
  assert.deepEqual(await cache.read(), saved);
  assert.equal(calls, 3);
  now = 179999;
  assert.deepEqual(await cache.read(), saved);
  assert.equal(calls, 3);
});
