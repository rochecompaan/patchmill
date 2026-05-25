import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTriageLog } from "./log.ts";

test("writeTriageLog writes timestamped JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "triage-log-"));
  const path = await writeTriageLog(dir, {
    mode: "dry-run",
    createdAt: "2026-05-08T12:00:00.000Z",
    issues: [
      {
        issueNumber: 1,
        title: "Issue",
        previousLabels: ["bug"],
        finalLabels: ["bug", "agent-ready"],
        primaryBucket: "agent-ready",
        rationale: "Clear issue.",
        questions: [],
        comment: null,
        mutationStatus: "preview",
      },
    ],
  });

  assert.match(path, /triage-2026-05-08T12-00-00-000Z\.json$/);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  assert.equal(parsed.mode, "dry-run");
  assert.equal(parsed.issues[0].issueNumber, 1);
});
