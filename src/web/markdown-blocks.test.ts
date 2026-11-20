import assert from "node:assert/strict";
import { test } from "node:test";
import {
  markdownBlocks,
  markdownLinks,
  markdownTitle,
} from "./markdown-blocks.ts";

const text = (value: string) => ({ kind: "text" as const, text: value });

test("headings of any level become heading blocks", () => {
  assert.deepEqual(markdownBlocks("# A\n\n### B"), [
    { kind: "heading", content: [text("A")] },
    { kind: "heading", content: [text("B")] },
  ]);
});

test("fenced code keeps raw text", () => {
  assert.deepEqual(
    markdownBlocks(
      "```mermaid\nflowchart LR\n  a --> b\n```\n\n~~~\n<script>x()</script>\n  **raw**\n~~~",
    ),
    [
      { kind: "code", text: "flowchart LR\n  a --> b" },
      { kind: "code", text: "<script>x()</script>\n  **raw**" },
    ],
  );
});

test("lists flatten nesting and join continuation lines", () => {
  assert.deepEqual(markdownBlocks("- a\n  more\n  - b\n1. c"), [
    { kind: "list", ordered: false, items: [[text("a more")], [text("b")]] },
    { kind: "list", ordered: true, items: [[text("c")]] },
  ]);
});

test("pipe tables become plain text cells", () => {
  assert.deepEqual(markdownBlocks("| A | **B** |\n|---|---|\n| 1 | `x` |"), [
    { kind: "table", headers: ["A", "B"], rows: [["1", "x"]] },
  ]);
});

test("blockquotes and raw HTML are paragraphs of text", () => {
  assert.deepEqual(markdownBlocks("> q\n\n<iframe src=x></iframe>"), [
    { kind: "paragraph", content: [text("q")] },
    { kind: "paragraph", content: [text("<iframe src=x></iframe>")] },
  ]);
});

test("paragraph lines join and thematic breaks separate blocks", () => {
  assert.deepEqual(markdownBlocks("one\ntwo\n---\nthree"), [
    { kind: "paragraph", content: [text("one two")] },
    { kind: "paragraph", content: [text("three")] },
  ]);
});

test("inline markers", () => {
  assert.deepEqual(
    markdownBlocks(
      "a `c` **s** *e* _e_ [h](https://x.test) [r](../m.html) ![alt](i.png) [j](javascript:x)",
    ),
    [
      {
        kind: "paragraph",
        content: [
          text("a "),
          { kind: "code", text: "c" },
          text(" "),
          { kind: "strong", text: "s" },
          text(" "),
          { kind: "emphasis", text: "e" },
          text(" "),
          { kind: "emphasis", text: "e" },
          text(" "),
          { kind: "link", text: "h", href: "https://x.test" },
          text(" r alt j"),
        ],
      },
    ],
  );
});

test("unclosed markers stay text", () => {
  assert.deepEqual(markdownBlocks("**a `b"), [
    { kind: "paragraph", content: [text("**a `b")] },
  ]);
});

test("markdownTitle reads the first level-one heading", () => {
  assert.equal(markdownTitle("intro\n# Title *x*\n"), "Title x");
  assert.equal(markdownTitle("## Not\n\n```\n# code\n```\ntext"), null);
});

test("markdownLinks lists inline links outside code, not images", () => {
  assert.deepEqual(
    markdownLinks(
      "See [Mock](../m.html#top) and ![i](a.html).\n\n```\n[no](x.html)\n```\n\n| [T](t.html) |\n|---|\n- [L](l.html)",
    ),
    [
      { text: "Mock", target: "../m.html#top" },
      { text: "T", target: "t.html" },
      { text: "L", target: "l.html" },
    ],
  );
});

test("double backtick code spans hide their content", () => {
  assert.deepEqual(markdownBlocks("x `` `[t](h)` `` y"), [
    {
      kind: "paragraph",
      content: [text("x "), { kind: "code", text: "`[t](h)`" }, text(" y")],
    },
  ]);
  assert.deepEqual(markdownLinks("`` `[t](h.html)` ``"), []);
});

test("fences nested in list items stay code blocks", () => {
  assert.deepEqual(
    markdownBlocks(
      "1. Run:\n\n    ```bash\n    npm test\n      --watch\n    ```\n\n2. Then\n   - nested\n\n     ~~~\n     a\n     ~~~\n",
    ),
    [
      { kind: "list", ordered: true, items: [[text("Run:")]] },
      { kind: "code", text: "npm test\n  --watch" },
      {
        kind: "list",
        ordered: true,
        items: [[text("Then")], [text("nested")]],
      },
      { kind: "code", text: "a" },
    ],
  );
});
