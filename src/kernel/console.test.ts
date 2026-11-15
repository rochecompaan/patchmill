import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { Issue } from "../host/types.ts";
import { formatRunResult, formatRunStart } from "./console.ts";

const issue: Issue = {
  number: 9,
  title: "Login \u001b[31mred\u001b[0m\nsecond line 界",
  body: "",
  labels: [],
  state: "open",
  url: "https://example.invalid/9",
  author: "fixture",
  createdAt: "2026-10-15",
  comments: [],
};

test("readable results wrap narrow terminals and do not render untrusted terminal controls", () => {
  for (const width of [1, 2, 17, 40, 80]) {
    for (const color of [false, true]) {
      const text = formatRunResult(
        {
          label: "Specification approval required",
          severity: "warning",
          issue,
          summary: "Review \u001b]0;untrusted title\u0007the specification",
          logPath: "/tmp/long-worktree-name/issue-9/20261015-120000/界/pi.log",
          warnings: ["Unpushed work"],
          cost: "Cost: unavailable",
        },
        { width, color },
      );
      for (const line of text.split("\n")) {
        assert.ok(
          visibleWidth(line) <= width,
          `width=${width}, color=${color}: ${JSON.stringify(line)}`,
        );
      }
      assert.doesNotMatch(text, /\u001b\]|\u0007|\u001b\[31mred/);
      const plain = stripTerminalSequences(text);
      assert.doesNotMatch(plain, /\u001b/);
      if (color) assert.match(text, /\u001b\[1m/);
      else assert.doesNotMatch(text, /\u001b/);
    }
  }
});

test("artifacts list the parent specification before the specification", () => {
  const text = formatRunResult(
    {
      label: "Done",
      severity: "success",
      issue,
      facts: {
        stage: "implementation",
        branch: "agent/issue-9-x",
        remoteBranchExists: true,
        worktree: "/tmp/tree",
        baseBranch: "main",
        expectedSpecPath: "s",
        expectedPlanPath: "p",
        specPath: "docs/specs/child.md",
        parentSpec: { issue: 356, path: "docs/specs/p-design.md" },
      },
    },
    { width: 120, color: false },
  );
  assert.ok(text.includes("Parent specification"));
  assert.ok(text.includes("docs/specs/p-design.md"));
  assert.ok(text.includes("from #356"));
  assert.ok(
    text.indexOf("Parent specification") < text.indexOf("• Specification"),
  );
});

test("selection progress keeps issue-supplied text on one plain line", () => {
  const text = formatRunStart(issue);
  assert.equal(text, "issue #9 · Login red second line 界");
  assert.doesNotMatch(text, /\n|\u001b/);
});
