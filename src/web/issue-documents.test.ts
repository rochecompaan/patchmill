import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { DEFAULT_CONFIG } from "../config/config.ts";
import { runCommand, type CommandRunner } from "../process/command.ts";
import type { Artifact } from "./api-types.ts";
import {
  createDocumentCache,
  createIssueDocumentReader,
  issueRefsFingerprint,
} from "./issue-documents.ts";

const BRANCH = "agent/issue-9-docs";
const SPEC = "docs/specs/2026-11-20-issue-9-docs-design.md";
const PLAN = "docs/plans/2026-11-20-issue-9-docs-plan.md";
const MOCKUP = "docs/mockups/m.html";
const SHOW_ME = "docs/specs/2026-11-20-issue-9-docs-design-show-me.html";
const SPEC_BODY =
  "# Docs\n\nSee [Full-page mockup](../mockups/m.html) and " +
  "[](../specs/2026-11-20-issue-9-docs-design-show-me.html).\n";
const id = (kind: string, path: string) =>
  `${kind}-${createHash("sha256").update(path).digest("hex").slice(0, 12)}`;

async function repo(t: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "patchmill-issue-docs-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.test");
  git("config", "user.name", "Test");
  git("commit", "-q", "--allow-empty", "-m", "Base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  const write = async (files: Record<string, string>) => {
    for (const [path, body] of Object.entries(files)) {
      await fs.mkdir(dirname(join(root, path)), { recursive: true });
      await fs.writeFile(join(root, path), body);
    }
  };
  const commit = async (files: Record<string, string>, message = "Docs") => {
    await write(files);
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const calls: string[][] = [];
  const warnings: string[] = [];
  const runner: CommandRunner = (cmd, args, opts) => {
    calls.push([cmd, ...args]);
    return runCommand(cmd, args, opts);
  };
  const input = {
    repoRoot: root,
    config: structuredClone(DEFAULT_CONFIG),
    baseBranch: "main",
    repositoryUrl: "https://host/owner/repo",
    provider: "github-gh" as const,
    runner,
    warn: (message: string) => warnings.push(message),
  };
  return { root, git, write, commit, calls, warnings, input };
}

const byKind = (artifacts: readonly Artifact[], kind: Artifact["kind"]) =>
  artifacts.find((a) => a.kind === kind)!;

test("local-only documents are drafts", async (t) => {
  const r = await repo(t);
  r.git("checkout", "-q", "-b", BRANCH);
  const head = await r.commit({
    [SPEC]: SPEC_BODY,
    [PLAN]: "# Plan\n",
    [MOCKUP]: "<p>m</p>",
    [SHOW_ME]: "<p>d</p>",
  });
  const docs = await createIssueDocumentReader(r.input)(9, [BRANCH]);
  assert.deepEqual(
    docs.artifacts.map((a) => a.kind),
    ["spec", "plan", "mockup", "diagram"],
  );
  const local = `On local branch ${BRANCH}. Not pushed yet.`;
  const spec = byKind(docs.artifacts, "spec");
  assert.equal(spec.id, "spec");
  assert.equal(spec.title, "Docs");
  assert.equal(spec.path, SPEC);
  assert.equal(spec.draft, true);
  assert.equal(spec.sourceUrl, null);
  assert.equal(spec.location, local);
  assert.equal(spec.commit, head.slice(0, 7));
  assert.equal(spec.preview.kind, "document");
  const mockup = byKind(docs.artifacts, "mockup");
  assert.equal(mockup.id, id("mockup", MOCKUP));
  assert.equal(mockup.title, "Full-page mockup");
  assert.deepEqual(mockup.preview, {
    kind: "page",
    url: `/files/issues/9/${id("mockup", MOCKUP)}`,
  });
  assert.equal(mockup.draft, true);
  assert.equal(mockup.location, local);
  const diagram = byKind(docs.artifacts, "diagram");
  assert.equal(diagram.id, id("diagram", SHOW_ME));
  assert.equal(diagram.title, "2026-11-20-issue-9-docs-design-show-me.html");
});

test("pushed blobs are not drafts", async (t) => {
  const r = await repo(t);
  r.git("checkout", "-q", "-b", BRANCH);
  const pushed = await r.commit({ [SPEC]: SPEC_BODY, [PLAN]: "# Plan\n" });
  r.git("update-ref", `refs/remotes/origin/${BRANCH}`, pushed);
  const first = await createIssueDocumentReader(r.input)(9, [BRANCH]);
  const spec = byKind(first.artifacts, "spec");
  assert.equal(spec.draft, false);
  assert.equal(spec.location, `On branch ${BRANCH}`);
  assert.equal(
    spec.sourceUrl,
    `https://host/owner/repo/blob/${pushed}/docs/specs/2026-11-20-issue-9-docs-design.md`,
  );
  const local = await r.commit({ [PLAN]: "# Plan v2\n" });
  const next = await createIssueDocumentReader(r.input)(9, [BRANCH]);
  const spec2 = byKind(next.artifacts, "spec");
  assert.equal(spec2.draft, false);
  assert.equal(spec2.commit, pushed.slice(0, 7));
  const plan = byKind(next.artifacts, "plan");
  assert.equal(plan.draft, true);
  assert.equal(plan.location, `On local branch ${BRANCH}. Not pushed yet.`);
  assert.equal(plan.commit, local.slice(0, 7));
  assert.equal(plan.sourceUrl, null);
});

test("base blobs on an unpushed branch", async (t) => {
  const r = await repo(t);
  const base = await r.commit({ [SPEC]: "# Docs\n" });
  r.git("update-ref", "refs/remotes/origin/main", base);
  r.git("checkout", "-q", "-b", BRANCH);
  await r.commit({ [PLAN]: "# Plan\n" });
  const docs = await createIssueDocumentReader(r.input)(9, [BRANCH]);
  const spec = byKind(docs.artifacts, "spec");
  assert.equal(spec.location, "On main");
  assert.equal(spec.draft, false);
  assert.equal(spec.commit, base.slice(0, 7));
  assert.match(spec.sourceUrl!, new RegExp(`/blob/${base}/`));
  assert.equal(
    byKind(docs.artifacts, "plan").location,
    `On local branch ${BRANCH}. Not pushed yet.`,
  );
});

test("base documents", async (t) => {
  const r = await repo(t);
  const base = await r.commit({ [SPEC]: "# Docs\n" });
  r.git("update-ref", "refs/remotes/origin/main", base);
  r.git("checkout", "-q", "--detach");
  r.git("branch", "-D", "main");
  const docs = await createIssueDocumentReader(r.input)(9, [BRANCH]);
  assert.deepEqual(
    docs.artifacts.map((a) => [a.kind, a.location, a.draft]),
    [["spec", "On main", false]],
  );
});

test("refuses links outside the documents", async (t) => {
  const r = await repo(t);
  r.git("checkout", "-q", "-b", BRANCH);
  await r.write({ "docs/mockups/real.html": "<p>r</p>" });
  await fs.symlink("real.html", join(r.root, "docs/mockups/link.html"));
  await r.commit({
    "outside.html": "<p>o</p>",
    "docs/mockups/m.html": "<p>m</p>",
    "docs/mockups/x.md": "# x",
    [SPEC]: [
      "# Docs",
      "[a](https://x.test/a.html)",
      "[b](/abs.html)",
      "[c](../../../outside.html)",
      "[d](../mockups/m.html?x)",
      "[e](../mockups/m%2e.html)",
      "[f](../mockups/link.html)",
      "[g](../mockups/missing.html)",
      "[h](../mockups/x.md)",
      "[i](..\\mockups\\m.html)",
      "[j](../mockups)",
    ].join("\n\n"),
  });
  const docs = await createIssueDocumentReader(r.input)(9, [BRANCH]);
  assert.deepEqual(
    docs.artifacts.map((a) => a.kind),
    ["spec"],
  );
});

test("an in-repository link outside the doc directories is allowed", async (t) => {
  const r = await repo(t);
  r.git("checkout", "-q", "-b", BRANCH);
  await r.commit({
    "docs/mockups/m.html": "<p>m</p>",
    [SPEC]: "# Docs\n\n[m](../mockups/m.html#part) [again](../mockups/m.html)",
  });
  const docs = await createIssueDocumentReader(r.input)(9, [BRANCH]);
  assert.deepEqual(
    docs.artifacts.map((a) => [a.kind, a.path, a.title]),
    [
      ["spec", SPEC, "Docs"],
      ["mockup", MOCKUP, "m"],
    ],
  );
});

test("limits", async (t) => {
  const r = await repo(t);
  const base = await r.commit({ [SPEC]: "# Small\n" });
  r.git("update-ref", "refs/remotes/origin/main", base);
  r.git("checkout", "-q", "-b", BRANCH);
  const big = "# Big\n\n[m](../mockups/m.html)\n" + "x".repeat(1024 * 1024);
  const files: Record<string, string> = {
    [SPEC]: big,
    [MOCKUP]: "<p>m</p>",
  };
  const links: string[] = [];
  for (let n = 0; n < 21; n++) {
    files[`docs/mockups/p${n}.html`] = `<p>${n}</p>`;
    links.push(`[p${n}](../mockups/p${n}.html)`);
  }
  files[PLAN] = "# Plan\n\n" + links.join("\n\n");
  await r.commit(files);
  const reader = createIssueDocumentReader(r.input);
  const docs = await reader(9, [BRANCH]);
  assert.equal(
    docs.artifacts.some((a) => a.kind === "spec"),
    false,
  );
  assert.equal(
    docs.artifacts.some((a) => a.path === MOCKUP),
    false,
  );
  assert.equal(docs.artifacts.filter((a) => a.kind === "mockup").length, 20);
  assert.equal(r.warnings.length, 1);
  await reader(9, [BRANCH]);
  assert.equal(r.warnings.length, 1, "warns once for each blob ID");
});

test("cache spans readers", async (t) => {
  const r = await repo(t);
  r.git("checkout", "-q", "-b", BRANCH);
  await r.commit({ [SPEC]: SPEC_BODY, [MOCKUP]: "<p>m</p>" });
  const cache = createDocumentCache();
  await createIssueDocumentReader({ ...r.input, cache })(9, [BRANCH]);
  await createIssueDocumentReader({ ...r.input, cache })(9, [BRANCH]);
  const catFiles = r.calls.filter((c) => c.includes("cat-file"));
  assert.equal(catFiles.length, 1);
});

test("file returns only listed HTML", async (t) => {
  const r = await repo(t);
  r.git("checkout", "-q", "-b", BRANCH);
  await r.commit({
    [SPEC]: SPEC_BODY,
    [PLAN]: "# Plan\n",
    [MOCKUP]: "<p>m ✓</p>",
    "docs/specs/2026-11-20-issue-10-other-design.md":
      "# Other\n\n[o](../mockups/o.html)",
    "docs/mockups/o.html": "<p>o</p>",
  });
  const reader = createIssueDocumentReader(r.input);
  const docs = await reader(9, [BRANCH]);
  const file = await docs.file(id("mockup", MOCKUP));
  assert.equal(file?.contentType, "text/html; charset=utf-8");
  assert.equal(file?.body.toString("utf8"), "<p>m ✓</p>");
  for (const other of [
    "spec",
    "plan",
    "mockup-000000000000",
    id("mockup", "docs/mockups/o.html"),
    "../package.json",
  ])
    assert.equal(await docs.file(other), null, other);
});

test("issue prefixes do not overlap", async (t) => {
  const r = await repo(t);
  r.git("checkout", "-q", "-b", "agent/issue-38-a");
  await r.commit({ "a.txt": "a" });
  r.git("checkout", "-q", "-b", "agent/issue-384-b");
  await r.commit({
    "docs/specs/2026-11-20-issue-38-x-design.md": "# Wrong branch\n",
  });
  r.git("update-ref", "refs/remotes/origin/agent/issue-384-b", "HEAD");
  const fingerprint = () =>
    issueRefsFingerprint({
      repoRoot: r.root,
      runner: r.input.runner,
      issue: 38,
      baseBranch: "main",
    });
  const before = await fingerprint();
  assert.notEqual(before, "refs-unavailable");
  await r.commit({ "b.txt": "b" });
  r.git("update-ref", "refs/remotes/origin/agent/issue-384-b", "HEAD");
  assert.equal(await fingerprint(), before);
  r.git("checkout", "-q", "agent/issue-38-a");
  await r.commit({ "c.txt": "c" });
  const afterOwn = await fingerprint();
  assert.notEqual(afterOwn, before);
  r.git("update-ref", "refs/remotes/origin/main", "HEAD");
  assert.notEqual(await fingerprint(), afterOwn);
  const docs = await createIssueDocumentReader(r.input)(38, [
    "agent/issue-384-b",
  ]);
  assert.equal(
    r.calls.some((c) => c.includes("refs/heads/agent/issue-384-b^{commit}")),
    false,
  );
  assert.equal(
    docs.artifacts.some((a) => a.location.startsWith("On local")),
    false,
  );
});

test("ref fingerprint never throws", async () => {
  const value = await issueRefsFingerprint({
    repoRoot: "/nonexistent",
    runner: async () => {
      throw Error("boom");
    },
    issue: 9,
    baseBranch: "main",
  });
  assert.equal(value, "refs-unavailable");
  assert.equal(
    await issueRefsFingerprint({
      repoRoot: "/nonexistent",
      runner: async () => ({ code: 128, stdout: "", stderr: "fatal" }),
      issue: 9,
      baseBranch: "main",
    }),
    "refs-unavailable",
  );
});
