import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSpecFilename, buildSpecPath, findIssueSpec } from "./specs.ts";

test("buildSpecFilename creates deterministic issue spec filenames", () => {
  assert.equal(
    buildSpecFilename(
      42,
      "Add reusable pagination widget!",
      new Date("2026-06-13T10:00:00Z"),
    ),
    "2026-06-13-issue-42-add-reusable-pagination-widget-design.md",
  );
});

test("buildSpecPath joins configured specs directory and filename", () => {
  assert.equal(
    buildSpecPath("docs/specs", 7, "Empty issue", "2026-06-13T12:00:00Z"),
    join("docs/specs", "2026-06-13-issue-7-empty-issue-design.md"),
  );
});

test("findIssueSpec returns the first matching issue spec", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-specs-"));
  await writeFile(join(dir, "2026-06-12-issue-4-other-design.md"), "# Other\n");
  await writeFile(join(dir, "2026-06-13-issue-5-widget-design.md"), "# Spec\n");
  await writeFile(
    join(dir, "2026-06-14-issue-5-widget-v2-design.md"),
    "# Spec 2\n",
  );

  assert.equal(
    await findIssueSpec(dir, 5),
    join(dir, "2026-06-13-issue-5-widget-design.md"),
  );
});

test("findIssueSpec returns undefined when specs directory is missing", async () => {
  assert.equal(
    await findIssueSpec(join(tmpdir(), "missing-specs-dir"), 99),
    undefined,
  );
});
