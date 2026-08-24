import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import {
  normalizeTodoDoneStatuses,
  parseTodoDoneStatusesEnv,
  serializeTodoDoneStatuses,
  todoStatusIsDone,
} from "../../src/policy/todo-statuses.ts";

const statusArbitrary = fc.string({ maxLength: 20 });
const statusesArbitrary = fc.array(statusArbitrary, { maxLength: 20 });
const asciiStatusArbitrary = fc.stringMatching(/^[A-Za-z0-9 _-]{0,20}$/u);
const asciiStatusesArbitrary = fc.array(asciiStatusArbitrary, {
  maxLength: 20,
});

test("todo status normalization is idempotent and produces unique values", () => {
  fc.assert(
    fc.property(statusesArbitrary, (statuses) => {
      const normalized = normalizeTodoDoneStatuses(statuses);

      assert.deepEqual(normalizeTodoDoneStatuses(normalized), normalized);
      assert.ok(normalized.length > 0);
      assert.equal(new Set(normalized).size, normalized.length);
    }),
  );
});

test("serialized todo statuses round trip through the environment parser", () => {
  fc.assert(
    fc.property(statusesArbitrary, (statuses) => {
      assert.deepEqual(
        parseTodoDoneStatusesEnv(serializeTodoDoneStatuses(statuses)),
        normalizeTodoDoneStatuses(statuses),
      );
    }),
  );
});

test("done-status membership ignores ASCII case and surrounding space", () => {
  fc.assert(
    fc.property(asciiStatusesArbitrary, (statuses) => {
      const normalized = normalizeTodoDoneStatuses(statuses);

      for (const status of normalized) {
        assert.equal(
          todoStatusIsDone(`  ${status.toUpperCase()}  `, normalized),
          true,
        );
      }
    }),
  );
});
