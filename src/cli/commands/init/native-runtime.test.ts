import assert from "node:assert/strict";
import { access, chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { INLINE_IMPLEMENTATION_RUNTIME_FILES } from "../../../workflow/skill-runtime-requirements.ts";
import { buildRecommendedProjectSkillConfig } from "../../../workflow/skill-pack.ts";
import {
  assertSkillFile,
  defaultSkillSourceRoots,
  installProjectSkills,
  validateExistingSkillDirectory,
} from "./skill-installer.ts";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-native-runtime-"));
}

test("fresh installation publishes a usable inline workflow", async () => {
  const repoRoot = await tempRoot();
  try {
    const result = await installProjectSkills({
      repoRoot,
      sourceRoots: defaultSkillSourceRoots(),
    });
    assert.equal(
      result.skillConfig.implementation,
      ".patchmill/skills/inline-dev-with-validation-and-pr-checks",
    );
    await access(
      join(repoRoot, result.skillConfig.implementation, "review-appendix.md"),
    );
    assert.deepEqual(
      await validateExistingSkillDirectory(repoRoot, ".patchmill/skills"),
      buildRecommendedProjectSkillConfig(),
    );
    for (const requirement of INLINE_IMPLEMENTATION_RUNTIME_FILES) {
      const path = join(
        repoRoot,
        ".patchmill/skills",
        requirement.skillName,
        requirement.path,
      );
      await access(path);
      if (requirement.executable)
        assert.notEqual((await stat(path)).mode & 0o111, 0);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("native helpers must remain executable", async () => {
  const repoRoot = await tempRoot();
  try {
    const path = join(repoRoot, "helper");
    await writeFile(path, "#!/bin/sh\n");
    await chmod(path, 0o644);
    await assert.rejects(
      assertSkillFile(path, "helper", undefined, { executable: true }),
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("missing native runtime files prevent publication", async () => {
  assert.equal(INLINE_IMPLEMENTATION_RUNTIME_FILES.length, 10);
});
