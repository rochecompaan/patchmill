import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIssueFile } from "./issue-parser.ts";

test("parseIssueFile parses title, labels, and body", () => {
  const issue = parseIssueFile(
    "01-example.md",
    [
      "---",
      "title: Build the form",
      "labels: [feature, polish]",
      "---",
      "",
      "Create a useful form.",
    ].join("\n"),
  );

  assert.deepEqual(issue, {
    fileName: "01-example.md",
    title: "Build the form",
    labels: ["feature", "polish"],
    body: "Create a useful form.\n",
  });
});

test("parseIssueFile allows missing labels", () => {
  const issue = parseIssueFile(
    "11-vague.md",
    ["---", "title: Make it social", "---", "", "Needs discovery."].join("\n"),
  );

  assert.deepEqual(issue.labels, []);
  assert.equal(issue.body, "Needs discovery.\n");
});

test("parseIssueFile rejects missing title", () => {
  assert.throws(
    () => parseIssueFile("bad.md", "---\nlabels: [feature]\n---\nBody"),
    /bad\.md is missing required frontmatter field: title/,
  );
});

test("parseIssueFile rejects invalid label syntax", () => {
  assert.throws(
    () =>
      parseIssueFile("bad.md", "---\ntitle: Bad\nlabels: feature\n---\nBody"),
    /bad\.md labels must use \[label, other-label\] syntax/,
  );
});

test("parseIssueFile rejects empty labels", () => {
  assert.throws(
    () =>
      parseIssueFile(
        "bad.md",
        "---\ntitle: Bad\nlabels: [feature, ]\n---\nBody",
      ),
    /bad\.md labels include an empty value/,
  );
});
