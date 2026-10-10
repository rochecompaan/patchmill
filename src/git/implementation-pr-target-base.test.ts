import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommandRunner } from "../../test-support/command-runner.ts";
import type { CommandRunner } from "../command/types.ts";
import { PlanningRemoteBaseGit } from "./planning-remote-base.ts";
import type { RepositoryIdentity } from "../host/pull-requests.ts";
import { resolveImplementationPrTargetRemote } from "../workflow/implementation-pr-target-remote.ts";

const target: RepositoryIdentity = {
  provider: "forgejo-tea",
  host: "forge.example",
  owner: "team",
  repository: "project",
};
const runner = createCommandRunner();
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "patchmill-target-remote-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = async (...args: string[]) => {
    const result = await runner.run("git", args, { cwd: root });
    assert.equal(result.code, 0, result.stderr);
    return result.stdout;
  };
  await git("init", "-q");
  await git(
    "remote",
    "add",
    "origin",
    "https://forge.example/fork/project.git",
  );
  return { root, git };
}

test("fork publication selects only the configured fetch endpoint for the saved target", async (t) => {
  const { root, git } = await fixture(t);
  await git(
    "remote",
    "add",
    "upstream",
    "https://forge.example/team/project.git",
  );
  await git(
    "remote",
    "set-url",
    "--push",
    "upstream",
    "https://forge.example/fork/project.git",
  );
  const config = await git("config", "--local", "--list");
  assert.deepEqual(
    await resolveImplementationPrTargetRemote(runner, root, target),
    {
      remote: "upstream",
      url: "https://forge.example/team/project.git",
      targetRepository: target,
    },
  );
  assert.equal(await git("config", "--local", "--list"), config);
  await git("remote", "rename", "upstream", "team/upstream");
  assert.equal(
    (await resolveImplementationPrTargetRemote(runner, root, target)).remote,
    "team/upstream",
  );
});

test("missing, ambiguous and conflicting target fetch endpoints fail closed without config changes", async (t) => {
  const { root, git } = await fixture(t);
  await assert.rejects(
    resolveImplementationPrTargetRemote(runner, root, target),
    /no configured fetch remote/i,
  );
  await git(
    "remote",
    "add",
    "upstream",
    "https://forge.example/team/project.git",
  );
  await git(
    "remote",
    "add",
    "mirror",
    "ssh://git@forge.example/team/project.git",
  );
  await assert.rejects(
    resolveImplementationPrTargetRemote(runner, root, target),
    /ambiguous/i,
  );
  await git("remote", "remove", "mirror");
  await git(
    "config",
    "--add",
    "remote.upstream.url",
    "https://forge.example/other/project.git",
  );
  const config = await git("config", "--local", "--list");
  await assert.rejects(
    resolveImplementationPrTargetRemote(runner, root, target),
    /ambiguous/i,
  );
  assert.equal(await git("config", "--local", "--list"), config);
});

test("target-base fetch proves the upstream merge instead of the publishing fork", async (t) => {
  const { root, git } = await fixture(t);
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.test");
  await git("checkout", "-b", "main");
  await git("commit", "--allow-empty", "-m", "base");
  const old = (await git("rev-parse", "HEAD")).trim();
  const fork = join(root, "fork.git"),
    upstream = join(root, "target.git");
  await git("clone", "--bare", root, fork);
  await git("commit", "--allow-empty", "-m", "merged PR");
  const merged = (await git("rev-parse", "HEAD")).trim();
  await git("clone", "--bare", root, upstream);
  await git(
    "remote",
    "set-url",
    "origin",
    "ssh://git@forge.example/fork/project.git",
  );
  await git(
    "remote",
    "add",
    "upstream",
    "ssh://git@forge.example/team/project.git",
  );
  const ssh = join(root, "owned-fixture-ssh");
  await writeFile(
    ssh,
    `#!/bin/sh\ncase "$*" in\n *other.example*) exec git-upload-pack '${fork}' ;;\n *team/project.git*) exec git-upload-pack '${upstream}' ;;\n *fork/project.git*) exec git-upload-pack '${fork}' ;;\n *) exit 99 ;;\nesac\n`,
  );
  await chmod(ssh, 0o700);
  const controlled: CommandRunner = {
    run: (command, args, options) =>
      runner.run(command, args, {
        ...options,
        env: {
          ...process.env,
          ...options?.env,
          GIT_SSH_COMMAND: ssh,
          GIT_SSH_VARIANT: "ssh",
        },
      }),
  };
  const base = new PlanningRemoteBaseGit({
    runner: controlled,
    repoRoot: root,
    specsDir: "docs/specs",
    plansDir: "docs/plans",
  });
  const snapshot = await base.fetch({
    issueNumber: 226,
    remote: "origin",
    baseBranch: "main",
    targetRepository: target,
  });
  assert.equal(snapshot.baseOid, merged);
  assert.notEqual(snapshot.baseOid, old);
  assert.equal(
    (await git("--git-dir", fork, "rev-parse", "refs/heads/main")).trim(),
    old,
  );
  assert.equal(snapshot.remote, "upstream");
  // Git expands an original configured URL once. Refetching its expanded URL
  // as a new remote would apply a second, unrelated rewrite.
  await git("remote", "set-url", "upstream", "alias://team/project.git");
  await git("config", "url.ssh://git@forge.example/.insteadOf", "alias://");
  await git(
    "config",
    "url.ssh://git@other.example/.insteadOf",
    "ssh://git@forge.example/",
  );
  assert.equal(
    (await git("remote", "get-url", "upstream")).trim(),
    "ssh://git@forge.example/team/project.git",
  );
  const aliased = await base.fetch({
    issueNumber: 226,
    remote: "origin",
    baseBranch: "main",
    targetRepository: target,
  });
  assert.equal(
    aliased.baseOid,
    merged,
    "a verified remote must not reapply URL rewriting to a different repository",
  );
});

test("expanded insteadOf endpoint, not an apparent target URL, determines fetch authority", async (t) => {
  const { root, git } = await fixture(t);
  await git(
    "remote",
    "add",
    "upstream",
    "https://forge.example/team/project.git",
  );
  await git(
    "config",
    "url.https://elsewhere.example/.insteadOf",
    "https://forge.example/",
  );
  await assert.rejects(
    resolveImplementationPrTargetRemote(runner, root, target),
    /no configured fetch remote/i,
  );
});
