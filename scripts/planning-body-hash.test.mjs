import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bodyHash,
  planningBody,
} from "../skills/patchmill-planning/scripts/body-hash.mjs";

const script = fileURLToPath(
  new URL(
    "../skills/patchmill-planning/scripts/body-hash.mjs",
    import.meta.url,
  ),
);
const doc = (...lines) => lines.join("\n");

test("receipt-only edits keep the hash and body edits change it", () => {
  const body = ["# Plan", "", "Task A", ""];
  const a = doc(...body, "## Planning review", "", "A");
  const b = doc(...body, "## Planning review", "", "B");
  assert.equal(bodyHash(a), bodyHash(b));
  const changed = doc(
    "# Plan",
    "",
    "Task B",
    "",
    "## Planning review",
    "",
    "A",
  );
  assert.notEqual(bodyHash(a), bodyHash(changed));
});

for (const [name, open, inner, close] of [
  ["backtick", "```markdown", "## Planning review", "```"],
  ["longer backtick", "````markdown", "```", "````"],
  ["tilde", "~~~", "## Planning review", "~~~"],
]) {
  test(`ignores a record heading inside a fenced block (${name})`, () => {
    const make = (after) =>
      doc(
        "# Plan",
        open,
        inner,
        "## Planning review",
        close,
        after,
        "## Planning review",
        "ready",
      );
    assert.notEqual(bodyHash(make("Task A")), bodyHash(make("Task B")));
    assert.match(planningBody(make("Task A")), /Task A/);
  });
}

test("ignores headings inside fences in the record", () => {
  const make = (line) =>
    doc("# Plan", "body", "## Planning review", "```text", line, "```", "ok");
  assert.doesNotThrow(() => planningBody(make("## Findings")));
  assert.equal(bodyHash(make("## Findings")), bodyHash(make("## Other")));
});

test("rejects a second record", () => {
  const text = doc("# P", "## Planning review", "a", "## Planning review", "b");
  assert.throws(
    () => planningBody(text),
    /more than one Planning review section/,
  );
});

test("rejects a section after the record", () => {
  const later = doc(
    "# P",
    "body",
    "## Planning review",
    "ready",
    "## Later",
    "x",
  );
  assert.throws(
    () => planningBody(later),
    /Planning review must be the last section/,
  );
  const entry = doc("# P", "body", "## Planning review", "### Entry 2", "x");
  assert.doesNotThrow(() => planningBody(entry));
  const inline = doc(
    "# Plan",
    "body",
    "## Planning review",
    "ready",
    "```inline code```",
    "## Later",
    "Task A",
  );
  assert.throws(
    () => planningBody(inline),
    /Planning review must be the last section/,
  );
});

test("hashes the whole text when no record exists", () => {
  const text = doc("# Plan", "", "Task A", "");
  assert.equal(planningBody(text), text);
});

test("command prints the hash", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "body-hash-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const text = doc("# Plan", "body", "## Planning review", "ready", "");
  const file = join(dir, "plan.md");
  await writeFile(file, text);
  const ok = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, `${bodyHash(text)}\n`);

  const none = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(none.status, 1);
  assert.notEqual(none.stderr.trim(), "");

  const missing = spawnSync(process.execPath, [script, join(dir, "no.md")], {
    encoding: "utf8",
  });
  assert.equal(missing.status, 1);
  assert.notEqual(missing.stderr.trim(), "");

  const twice = join(dir, "twice.md");
  await writeFile(
    twice,
    doc("# P", "## Planning review", "## Planning review"),
  );
  const bad = spawnSync(process.execPath, [script, twice], {
    encoding: "utf8",
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /more than one Planning review section/);
});

test("handles CRLF and mixed line endings", () => {
  const crlf = (...lines) => lines.join("\r\n");
  const a = crlf("# Plan", "body", "## Planning review", "A", "");
  const b = crlf("# Plan", "body", "## Planning review", "B", "");
  assert.equal(planningBody(a), "# Plan\r\nbody\r\n");
  assert.equal(bodyHash(a), bodyHash(b));
  assert.throws(
    () => planningBody(crlf("# P", "## Planning review", "## Planning review")),
    /more than one Planning review section/,
  );
  assert.throws(
    () => planningBody(crlf("# P", "## Planning review", "x", "## Later")),
    /Planning review must be the last section/,
  );
  const fenced = (after) =>
    crlf(
      "# P",
      "```md",
      "## Planning review",
      "```",
      after,
      "## Planning review",
    );
  assert.notEqual(bodyHash(fenced("Task A")), bodyHash(fenced("Task B")));
  const mixed =
    "# P\n## Planning review\r\n```text\r\n## Findings\n```\r\nok\n";
  assert.doesNotThrow(() => planningBody(mixed));
  assert.equal(planningBody(mixed), "# P\n");
});
