import assert from "node:assert/strict";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { openIssueConsoleSession } from "./console-session.ts";

test("issue sessions use only that issue's newest file, or a fresh path in its directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "issue-console-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "runs/issue-2/console");
  const old = SessionManager.create(root, dir);
  old.appendMessage({ role: "user", content: "old", timestamp: 1 });
  const newest = SessionManager.create(root, dir);
  newest.appendMessage({ role: "user", content: "new", timestamp: 2 });
  await utimes(old.getSessionFile()!, 1, 1);
  const other = SessionManager.create(root, join(root, "runs/issue-1/console"));
  other.appendMessage({ role: "user", content: "unrelated", timestamp: 3 });
  assert.equal(
    (await openIssueConsoleSession(root, "runs", 2)).getSessionFile(),
    newest.getSessionFile(),
  );
  for (const issue of [3, 4]) {
    const fresh = await openIssueConsoleSession(root, "runs", issue);
    assert.equal(
      fresh.getSessionDir(),
      join(root, `runs/issue-${issue}/console`),
    );
    assert.deepEqual(fresh.getBranch(), []);
    // The public API accepts the not-yet-persisted path for replacement.
    const reopened = SessionManager.open(
      fresh.getSessionFile()!,
      undefined,
      root,
    );
    assert.equal(reopened.getSessionDir(), fresh.getSessionDir());
    assert.equal(reopened.getCwd(), root);
    await openIssueConsoleSession(root, "runs", issue); // now an existing empty directory
  }
});
