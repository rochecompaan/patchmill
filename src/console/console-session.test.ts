import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes } from "node:fs/promises";
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
    if (issue === 4)
      await mkdir(join(root, "runs/issue-4/console"), { recursive: true });
    const fresh = await openIssueConsoleSession(root, "runs", issue);
    assert.equal(
      fresh.getSessionDir(),
      join(root, `runs/issue-${issue}/console`),
    );
    assert.equal(fresh.getBranch().length, 1);
    assert.equal(fresh.getBranch()[0]?.type, "message");
    // The genuine start request persists the path before replacement/forking.
    const reopened = SessionManager.open(
      fresh.getSessionFile()!,
      undefined,
      root,
    );
    assert.equal(reopened.getSessionDir(), fresh.getSessionDir());
    assert.equal(reopened.getCwd(), root);
    await openIssueConsoleSession(root, "runs", issue); // reopening keeps the conversation
  }
});

test("a fresh issue entering implementation can fork before any provider response", async (t) => {
  const { pathToFileURL } = await import("node:url");
  const { resolvePiSubagentsPackageRoot } =
    await import("../pi/pi-subagents-package.ts");
  const { createForkContextResolver } = await import(
    pathToFileURL(
      join(resolvePiSubagentsPackageRoot(), "src/shared/fork-context.js"),
    ).href
  );
  const root = await mkdtemp(join(tmpdir(), "issue-fork-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const session = await openIssueConsoleSession(root, "runs", 9);
  // Implementation startup emits notifications, not an assistant response.
  session.appendCustomMessageEntry(
    "patchmill",
    "Implementation starting",
    true,
  );
  const fork = createForkContextResolver(session, "fork", {
    runDirName: () => "worker",
  });
  await fork.prepareSessionForIndex(0);
  const child = SessionManager.open(fork.sessionFileForIndex(0));
  assert.ok(
    child
      .getBranch()
      .some(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "user" &&
          entry.message.content === "Start Issue run #9.",
      ),
  );
  assert.equal(
    child
      .getBranch()
      .some(
        (entry) =>
          entry.type === "message" && entry.message.role === "assistant",
      ),
    false,
  );
});
