import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandRunner } from "../command/types.ts";
import {
  RunRepositoryNamespaceConflictError,
  resolveRunRepositoryNamespace,
} from "./run-repository-namespace.ts";

const host = {
  provider: "github" as const,
  host: "github.example.test",
  owner: "patchmill",
  repository: "demo",
};

function runner(commonDir: string): CommandRunner {
  return {
    run: async (_command, args) => {
      assert.deepEqual(args, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]);
      return { code: 0, stdout: `${commonDir}\n`, stderr: "" };
    },
  };
}

test("canonical aliases share a repository namespace", async () => {
  const root = await mkdtemp(join(tmpdir(), "run-namespace-"));
  try {
    const clone = join(root, "clone");
    const alias = join(root, "clone-alias");
    const common = join(root, "common");
    await mkdir(clone);
    await mkdir(common);
    await symlink(clone, alias);
    const input = {
      hostRepository: host,
      runStateDir: "state",
      worktreeRoot: "workspaces",
      todoRoot: "todos",
    };
    const original = await resolveRunRepositoryNamespace(runner(common), {
      ...input,
      repoRoot: clone,
    });
    const throughAlias = await resolveRunRepositoryNamespace(runner(common), {
      ...input,
      repoRoot: alias,
    });
    assert.deepEqual(throughAlias, original);
    assert.equal(original.cloneRoot, clone);
    assert.deepEqual(original.todoRoot, {
      kind: "workspace-relative",
      path: "todos",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects every changed bound namespace identity before issue effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "run-namespace-"));
  try {
    const clone = join(root, "clone");
    const common = join(root, "common");
    await mkdir(clone);
    await mkdir(common);
    const input = {
      repoRoot: clone,
      hostRepository: host,
      runStateDir: join(root, "state"),
      worktreeRoot: join(root, "workspaces"),
      todoRoot: join(root, "todos"),
    };
    await resolveRunRepositoryNamespace(runner(common), input);
    for (const changed of [
      { ...input, runStateDir: join(root, "other-state") },
      { ...input, worktreeRoot: join(root, "other-workspaces") },
      { ...input, todoRoot: join(root, "other-todos") },
      { ...input, hostRepository: { ...host, repository: "other" } },
    ]) {
      await assert.rejects(
        resolveRunRepositoryNamespace(runner(common), changed),
        RunRepositoryNamespaceConflictError,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a namespace identity mismatch before issue effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "run-namespace-"));
  try {
    const clone = join(root, "clone");
    const common = join(root, "common");
    await mkdir(clone);
    await mkdir(common);
    const input = {
      repoRoot: clone,
      hostRepository: host,
      runStateDir: join(root, "state"),
      worktreeRoot: join(root, "workspaces"),
      todoRoot: join(root, "todos"),
    };
    await resolveRunRepositoryNamespace(runner(common), input);
    await assert.rejects(
      resolveRunRepositoryNamespace(runner(common), {
        ...input,
        hostRepository: { ...host, repository: "other" },
      }),
      RunRepositoryNamespaceConflictError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
