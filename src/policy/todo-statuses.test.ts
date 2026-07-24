import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TODO_DONE_STATUSES,
  parseTodoDoneStatusesEnv,
  serializeTodoDoneStatuses,
  todoStatusIsDone,
} from "./todo-statuses.ts";

test("default todo done statuses include compatibility aliases", () => {
  assert.deepEqual(DEFAULT_TODO_DONE_STATUSES, [
    "closed",
    "completed",
    "complete",
    "done",
  ]);
});

test("todoStatusIsDone trims and compares case-insensitively", () => {
  assert.equal(todoStatusIsDone(" COMPLETE "), true);
  assert.equal(todoStatusIsDone("Done"), true);
  assert.equal(todoStatusIsDone("open"), false);
  assert.equal(todoStatusIsDone(undefined), false);
});

test("custom done statuses are authoritative after normalization", () => {
  assert.equal(todoStatusIsDone(" shipped ", ["SHIPPED"]), true);
  assert.equal(todoStatusIsDone("complete", ["shipped"]), false);
});

test("todo done status env serialization parses valid arrays and falls back safely", () => {
  assert.deepEqual(
    parseTodoDoneStatusesEnv(
      serializeTodoDoneStatuses([" Shipped ", "shipped", ""]),
    ),
    ["shipped"],
  );
  assert.deepEqual(
    parseTodoDoneStatusesEnv("not json"),
    DEFAULT_TODO_DONE_STATUSES,
  );
  assert.deepEqual(
    parseTodoDoneStatusesEnv(JSON.stringify([])),
    DEFAULT_TODO_DONE_STATUSES,
  );
  assert.deepEqual(
    parseTodoDoneStatusesEnv(JSON.stringify(["", "  "])),
    DEFAULT_TODO_DONE_STATUSES,
  );
  assert.deepEqual(
    parseTodoDoneStatusesEnv(JSON.stringify(["done", 3])),
    DEFAULT_TODO_DONE_STATUSES,
  );
});
