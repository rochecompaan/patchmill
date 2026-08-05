import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  changedTrackedFiles,
  restoreTrackedPaths,
  snapshotTrackedPaths,
} from "./tracked-files.mjs";

test("reports and restores nested tracked file changes without Git", async () => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-tracked-files-"));
  const roots = ["package.json", ".patchmill/skills", "nix/package.nix"];
  try {
    const skill = join(root, ".patchmill/skills/writing-plans/SKILL.md");
    await mkdir(join(root, ".patchmill/skills/writing-plans"), {
      recursive: true,
    });
    await writeFile(join(root, "package.json"), "old\n");
    await writeFile(skill, "old skill\n");
    await chmod(skill, 0o755);
    const before = await snapshotTrackedPaths(root, roots);
    await writeFile(join(root, "package.json"), "new\n");
    await rm(skill);
    await writeFile(
      join(root, ".patchmill/skills/writing-plans/reference.md"),
      "new\n",
    );
    await mkdir(join(root, "nix"), { recursive: true });
    await writeFile(join(root, "nix/package.nix"), "new\n");
    const after = await snapshotTrackedPaths(root, roots);
    assert.deepEqual(changedTrackedFiles(before, after), [
      ".patchmill/skills/writing-plans/SKILL.md",
      ".patchmill/skills/writing-plans/reference.md",
      "nix/package.nix",
      "package.json",
    ]);
    await restoreTrackedPaths(root, roots, before);
    assert.equal(await readFile(join(root, "package.json"), "utf8"), "old\n");
    assert.equal(await readFile(skill, "utf8"), "old skill\n");
    assert.equal((await stat(skill)).mode & 0o777, 0o755);
    await assert.rejects(access(join(root, "nix/package.nix")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
