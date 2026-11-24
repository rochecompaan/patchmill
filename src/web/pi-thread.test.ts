import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPiThread } from "./pi-thread.ts";

const EXPIRED =
  "Your authentication token has expired. Please try refreshing it.";
const AT = "2026-11-23T10:00:00.000Z";
const header = { type: "session", id: "h", timestamp: AT };
const message = (id: string, m: Record<string, unknown>) => ({
  type: "message",
  id,
  timestamp: AT,
  message: m,
});
const failed = (
  id: string,
  errorMessage: string,
  content: unknown[] = [],
  stopReason = "error",
) => message(id, { role: "assistant", content, stopReason, errorMessage });
const project = (records: unknown[]) =>
  projectPiThread({
    records,
    prefix: "p",
    collapseFirstUser: false,
    seen: new Set(),
  });

test("a failed assistant record becomes an error event", () => {
  const events = project([
    header,
    message("u", { role: "user", content: "Hello" }),
    failed("a", EXPIRED),
  ]);
  const last = events.at(-1);
  assert.equal(last?.kind, "error");
  assert.equal(last?.id, "p:1:error");
  assert.equal(last?.at, AT);
  if (last?.kind === "error") {
    assert.equal(last.title, "Sign-in failed");
    assert.match(last.text, /Run patchmill auth/);
  }
});

test("text before a failure stays before the error event", () => {
  const events = project([
    header,
    failed("a", "Overloaded", [{ type: "text", text: "Partial" }]),
  ]);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["message", "error"],
  );
  const [text, error] = events;
  if (text?.kind === "message")
    assert.deepEqual(text.blocks, [
      { kind: "paragraph", content: [{ kind: "text", text: "Partial" }] },
    ]);
  if (error?.kind === "error") assert.equal(error.text, "Overloaded.");
});

test("a retried failure keeps both the error and the reply", () => {
  const events = project([
    header,
    failed("a", "Overloaded"),
    message("b", {
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
      stopReason: "stop",
    }),
  ]);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["error", "message"],
  );
  const reply = events[1];
  if (reply?.kind === "message")
    assert.deepEqual(reply.blocks, [
      { kind: "paragraph", content: [{ kind: "text", text: "Done" }] },
    ]);
});

test("an aborted record gives no error event", () => {
  assert.deepEqual(project([header, failed("a", "x", [], "aborted")]), []);
});

test("a failed record without a content array still gives an error event", () => {
  const events = project([
    header,
    message("a", { role: "assistant", stopReason: "error", errorMessage: "x" }),
  ]);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["error"],
  );
});
