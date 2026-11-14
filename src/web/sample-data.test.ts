import assert from "node:assert/strict";
import { test } from "node:test";
import { createSampleRunDataSource } from "./sample-data.ts";

test("sample projection covers every state without exposing mutable fixtures", async () => {
  const source = createSampleRunDataSource();
  const snapshot = await source.snapshot();
  assert.equal(snapshot.source, "sample");
  assert.equal(snapshot.syncedAt, null);
  assert.deepEqual(
    new Set(snapshot.issues.map((i) => i.status)),
    new Set([
      "none",
      "working",
      "waiting",
      "idle",
      "paused",
      "blocked",
      "done",
    ]),
  );
  assert.equal(new Set(snapshot.issues.map((i) => i.column)).size, 7);
  assert.equal(Reflect.set(snapshot.issues[0]!, "title", "changed"), false);
  assert.deepEqual((await source.snapshot()).issues, snapshot.issues);
});
test("every board summary has matching detail and valid artifacts", async () => {
  const snapshot = await createSampleRunDataSource().snapshot();
  const kinds = new Set<string>();
  const prs = new Set<string>();
  for (const summary of snapshot.issues) {
    const detail = snapshot.details[String(summary.number)]!;
    assert.deepEqual(detail.summary, summary);
    assert.equal(
      new Set(detail.thread.map((e) => e.id)).size,
      detail.thread.length,
    );
    for (const event of detail.thread) {
      if (event.at) assert.ok(Number.isFinite(Date.parse(event.at)));
      if (event.kind === "artifact")
        assert.ok(detail.artifacts.some((a) => a.id === event.artifactId));
      assert.equal("html" in event, false);
    }
    for (const artifact of detail.artifacts) {
      kinds.add(artifact.kind);
      if (artifact.preview.kind === "gallery")
        assert.ok(artifact.preview.shots.length > 0);
    }
    summary.pullRequests.forEach((pr) => prs.add(pr.kind));
  }
  assert.deepEqual(
    kinds,
    new Set(["spec", "plan", "mockup", "diagram", "shots"]),
  );
  assert.ok(prs.has("spec") && prs.has("plan"));
});
test("sample subscription is inert and unsubscribe is idempotent", async () => {
  let count = 0;
  const source = createSampleRunDataSource();
  const unsubscribe = source.subscribe(() => count++);
  await source.snapshot();
  unsubscribe();
  unsubscribe();
  assert.equal(count, 0);
});
