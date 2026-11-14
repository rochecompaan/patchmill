import assert from "node:assert/strict";
import { test } from "node:test";
import { createSampleRunDataSource } from "./sample-data.ts";
import { sampleThreads } from "./samples/threads.ts";

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
    assert.deepEqual(
      summary.artifacts,
      detail.artifacts.map(({ id, kind, title }) => ({ id, kind, title })),
    );
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
test("missing sample threads fail at the projection boundary with the issue number", () => {
  const descriptor = Object.getOwnPropertyDescriptor(sampleThreads, "227")!;
  Reflect.deleteProperty(sampleThreads, "227");
  try {
    assert.throws(
      () => createSampleRunDataSource(),
      /Missing sample thread for issue #227/,
    );
  } finally {
    Object.defineProperty(sampleThreads, "227", descriptor);
  }
});
