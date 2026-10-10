import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCommentIssueStateProvider,
  formatPatchmillStateComment,
  parsePatchmillStateComment,
  resolveCommentIssueWorkflowRoles,
} from "./comments.ts";

test("accepts scalar Patchmill front matter", () => {
  assert.deepEqual(
    parsePatchmillStateComment("---\nPatchmill: agent-ready\n---\n"),
    ["agent-ready"],
  );
});

test("accepts YAML-list Patchmill front matter", () => {
  assert.deepEqual(
    parsePatchmillStateComment(
      "---\nPatchmill:\n  - spec-approved\n  - plan-review\n---\n",
    ),
    ["spec-approved", "plan-review"],
  );
});

test("ignores malformed and unsupported comments", () => {
  assert.equal(parsePatchmillStateComment("Patchmill: agent-ready"), undefined);
  assert.equal(
    parsePatchmillStateComment("---\nPatchmill: unsupported\n---\n"),
    undefined,
  );
  assert.equal(
    parsePatchmillStateComment(
      "---\nPatchmill:\n  - agent-ready\n  - agent-ready\n---\n",
    ),
    undefined,
  );
});

test("resolver chooses the latest trusted comment by creation time", () => {
  assert.deepEqual(
    resolveCommentIssueWorkflowRoles(
      [
        {
          body: "---\nPatchmill: agent-ready\n---\n",
          authorLogin: "bot",
          created: "2026-01-01T00:00:00Z",
        },
        {
          body: "---\nPatchmill: in-progress\n---\n",
          authorLogin: "bot",
          created: "2026-01-02T00:00:00Z",
        },
        {
          body: "---\nPatchmill: agent-done\n---\n",
          authorLogin: "mallory",
          created: "2026-01-03T00:00:00Z",
        },
      ],
      ["bot"],
    ),
    ["in-progress"],
  );
});

test("resolver falls back to returned order when created times are missing", () => {
  assert.deepEqual(
    resolveCommentIssueWorkflowRoles(
      [
        { body: "---\nPatchmill: agent-ready\n---\n", authorLogin: "bot" },
        { body: "---\nPatchmill: blocked\n---\n", authorLogin: "bot" },
      ],
      ["bot"],
    ),
    ["blocked"],
  );
});

test("provider appends a state comment", async () => {
  const comments: string[] = [];
  const provider = await createCommentIssueStateProvider(
    {
      commentIssue: async (_issueNumber, body) => void comments.push(body),
      trustedTriageCommentAuthors: async () => ["bot"],
    },
    { provider: "comments" },
  );
  await provider.setRoles({
    issue: { number: 1, title: "", body: "", labels: [], state: "open" },
    roles: ["in-progress"],
    message: "Started.",
  });
  assert.deepEqual(comments, ["---\nPatchmill: in-progress\n---\n\nStarted."]);
});

test("formatPatchmillStateComment writes lists for multiple roles", () => {
  assert.equal(
    formatPatchmillStateComment(["spec-approved", "plan-review"]),
    "---\nPatchmill:\n  - spec-approved\n  - plan-review\n---",
  );
});
