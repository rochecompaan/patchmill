import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanningCompanionArtifactError,
  isPlanningCompanionPath,
  parsePlanningCompanionPaths,
  planningArtifactPaths,
} from "./planning-companion-artifacts.ts";

const specPath = "docs/specs/example.md";
const mockupPath = "docs/mockups/2026-10-13-example.html";
const entry = `- \`${mockupPath}\`:\n  [Full-page mockup](../mockups/2026-10-13-example.html)`;
const parse = (body: string) => parsePlanningCompanionPaths({ specPath, body });
const section = (entries: string) =>
  `# Example\n\n## Companion artifacts\n\n${entries}\n`;
const rejects = (body: string) =>
  assert.throws(() => parse(body), PlanningCompanionArtifactError);

test("parses wrapped declarations and CRLF", () => {
  assert.deepEqual(parse(section(entry).replaceAll("\n", "\r\n")), [
    mockupPath,
  ]);
  assert.deepEqual(parse(section(entry.replace("\n ", " "))), [mockupPath]);
  assert.deepEqual(parse(section(entry) + "\n## Requirements\nOther text"), [
    mockupPath,
  ]);
});

test("ignores fenced and raw HTML declaration examples", () => {
  for (const example of [
    `\`\`\`markdown\n${section(entry)}\`\`\`\n`,
    `<div>\n${section(entry).replaceAll("\n\n", "\n")}</div>\n\n`,
    `<!--\n${section(entry)}-->\n`,
    `<script>\n${section(entry)}</script>\n`,
    section(entry)
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n"),
    section(entry)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
  ]) {
    assert.deepEqual(parse(example), []);
    assert.deepEqual(parse(example + "\n\n" + section(entry)), [mockupPath]);
  }
});

test("raw closing tags and multiline block openings grant no companion authority", () => {
  for (const [opening, closing] of [
    ["</div> trailing text", ""],
    ['<div\nclass="example">', "</div>"],
    ['<script\ntype="text/plain">', "</script>"],
    ['<style\nmedia="screen">', "</style>"],
  ]) {
    const example = `${opening}\n## Companion artifacts\n${entry}\n${closing}\n`;
    assert.deepEqual(parse(example), [], opening);
    assert.deepEqual(
      parse(example + "\n\n" + section(entry)),
      [mockupPath],
      opening,
    );
  }
});

test("rejects malformed or repeated companion sections", () => {
  for (const text of [
    "",
    "not a declaration",
    "- missing path",
    entry + "\nUnexpected prose",
  ])
    rejects(section(text));
  rejects(section(entry) + section(entry));
});

test("rejects unsafe declared paths", () => {
  for (const path of [
    "/docs/mockups/a.html",
    "C:/docs/mockups/a.html",
    "docs\\mockups\\a.html",
    "docs/mockups/../a.html",
    "docs/mockups//a.html",
    "docs/mockups/./a.html",
    "docs/mockups/a\u0000.html",
    "docs/mockups/a\n.html",
    "docs/mockups/a.md",
    "src/a.html",
    "docs/mockups/a%20b.html",
    "docs/mockups/a.html?x",
    "docs/mockups/a.html#x",
  ]) {
    assert.equal(isPlanningCompanionPath(path), false, path);
    rejects(section(`- \`${path}\`: [Mockup](../mockups/a.html)`));
  }
});

test("requires a matching local link", () => {
  rejects(section(`- \`${mockupPath}\`:`));
  for (const link of [
    "https://example.com/a.html",
    "//example.com/a.html",
    "../mockups/%32%30%32%36-10-13-example.html",
    "../mockups/2026-10-13-example.html?x",
    "../mockups/2026-10-13-example.html#x",
    "../mockups/other.html",
  ]) {
    rejects(section(`- \`${mockupPath}\`: [Mockup](${link})`));
  }
});

test("rejects duplicate declarations", () =>
  rejects(section(`${entry}\n${entry}`)));

test("renders artifact and companion paths without mutation", () => {
  const artifacts = Object.freeze([
    Object.freeze({
      kind: "spec" as const,
      path: specPath,
      commitOid: "a".repeat(40),
      source: "workspace" as const,
      companionPaths: Object.freeze([mockupPath]),
    }),
    Object.freeze({
      kind: "plan" as const,
      path: "docs/plans/example.md",
      commitOid: "b".repeat(40),
      source: "workspace" as const,
    }),
  ]);
  assert.deepEqual(planningArtifactPaths([...artifacts, artifacts[0]]), [
    specPath,
    mockupPath,
    "docs/plans/example.md",
  ]);
  assert.deepEqual(artifacts[0].companionPaths, [mockupPath]);
});
