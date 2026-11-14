import assert from "node:assert/strict";
import { test } from "node:test";
import { syncText, mountSyncStatus } from "../../web/sync-status.js";

test("sync age uses whole nonnegative seconds and samples never claim a host sync", () => {
  assert.equal(
    syncText("live", new Date(0).toISOString(), 12999),
    "synced 12 s ago",
  );
  assert.equal(
    syncText("live", new Date(1000).toISOString(), 0),
    "synced 0 s ago",
  );
  assert.equal(syncText("sample", null, 12999), "Sample data");
  assert.equal(syncText("live", null, 0), "Not synced yet");
});

test("the freshness clock advances unchanged metadata without a page render and disposes once", () => {
  let now = 12999,
    stops = 0;
  let tick!: () => void;
  const node = { textContent: "" };
  const clock = mountSyncStatus(node, {
    now: () => now,
    every: (ms, fn) => {
      assert.equal(ms, 1000);
      tick = fn;
      return () => {
        stops++;
      };
    },
  });
  clock.update({ source: "live", syncedAt: new Date(0).toISOString() });
  assert.equal(node.textContent, "synced 12 s ago");
  now = 17000;
  tick();
  assert.equal(node.textContent, "synced 17 s ago");
  clock.update({ source: "sample", syncedAt: null });
  tick();
  assert.equal(node.textContent, "Sample data");
  clock.dispose();
  clock.dispose();
  now = 18000;
  tick();
  assert.equal(stops, 1);
});
