import assert from "node:assert/strict";
import { test } from "node:test";
import { upsertRunCostSection } from "./pr-cost.ts";
import type { IssueCostReport } from "./issue-cost.ts";

const start = "<!-- patchmill-run-cost:start -->";
const end = "<!-- patchmill-run-cost:end -->";
const report: IssueCostReport = {
  rows: [
    {
      phase: "planning",
      model: "model-a",
      usage: { inputTokens: 1000, outputTokens: 20, costUsd: 0.1 },
    },
    {
      phase: "implementation",
      model: "model|b\n<script>",
      usage: { inputTokens: 200, outputTokens: 30 },
    },
  ],
  total: { inputTokens: 1200, outputTokens: 50 },
};

test("cost sections preserve surrounding PR text, escape models, and keep incomplete prices unavailable", () => {
  const prefix = "Description\n\n";
  const suffix = "\n\nCloses #9\n";
  const body = upsertRunCostSection(
    `${prefix}${start}\nold table\n${end}${suffix}`,
    report,
  );
  assert.ok(body.startsWith(prefix + start));
  assert.ok(body.endsWith(end + suffix));
  assert.match(body, /Planning \| model-a \| 1,000 \| 20 \| \$0\.1000/);
  assert.ok(
    body.includes(
      "Implementation | model\\|b &lt;script&gt; | 200 | 30 | Unavailable",
    ),
  );
  assert.ok(
    body.includes("| **Total** |  | **1,200** | **50** | **Unavailable** |"),
  );
  assert.ok(!body.includes("old table"));
  assert.equal(upsertRunCostSection(body, report), body);
});

test("appending a cost section does not alter the original PR body", () => {
  for (const body of ["", "Closes #9", "Closes #9\n", "Closes #9\n\n"]) {
    const updated = upsertRunCostSection(body, report);
    assert.ok(updated.startsWith(body));
    assert.equal(updated.split(start).length - 1, 1);
    assert.equal(upsertRunCostSection(updated, report), updated);
  }
});

test("unbalanced, reversed, or repeated cost markers cannot overwrite the PR", () => {
  for (const body of [
    start,
    end,
    `${end}${start}`,
    `${start}${start}${end}`,
    `${start}${end}${end}`,
  ]) {
    assert.throws(
      () => upsertRunCostSection(body, report),
      /Malformed Patchmill run-cost markers/,
    );
  }
});
