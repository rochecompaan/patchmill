import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { INLINE_IMPLEMENTATION_RUNTIME_FILES } from "../../../workflow/skill-runtime-requirements.ts";
import { buildRecommendedProjectSkillConfig } from "../../../workflow/skill-pack.ts";
import {
  defaultSkillSourceRoots,
  installProjectSkills,
  validateExistingSkillDirectory,
  type SourceRoots,
} from "./skill-installer.ts";

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "patchmill-native-runtime-"));
  const roots = defaultSkillSourceRoots();
  const sourceRoots = {} as SourceRoots;
  for (const key of Object.keys(roots) as Array<keyof SourceRoots>) {
    sourceRoots[key] = join(root, key);
    await fs.cp(roots[key], sourceRoots[key], { recursive: true });
  }
  return { root, repoRoot: join(root, "repo"), sourceRoots };
}

function sourcePath(roots: SourceRoots, skillName: string, path: string) {
  return join(
    skillName === "inline-dev-with-validation-and-pr-checks"
      ? roots.patchmillSkillsDir
      : roots.superpowersSkillsDir,
    skillName,
    path,
  );
}

async function assertUnpublished(repoRoot: string) {
  await assert.rejects(fs.access(join(repoRoot, ".patchmill/skills")));
  const entries = await fs
    .readdir(join(repoRoot, ".patchmill"))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  assert.deepEqual(
    entries,
    [],
    "no metadata, partial pack, or staging directory",
  );
}

// These cases catch publication without validation, path-mode omissions, and
// copy operations that lose files or script permissions.
test("fresh installation publishes a usable inline workflow", async () => {
  const { root, repoRoot, sourceRoots } = await fixture();
  try {
    for (const requirement of INLINE_IMPLEMENTATION_RUNTIME_FILES) {
      if (requirement.executable) {
        await fs.chmod(
          sourcePath(sourceRoots, requirement.skillName, requirement.path),
          0o751,
        );
      }
    }
    const result = await installProjectSkills({ repoRoot, sourceRoots });
    assert.equal(
      result.skillConfig.implementation,
      ".patchmill/skills/inline-dev-with-validation-and-pr-checks",
    );
    await fs.access(
      join(repoRoot, result.skillConfig.implementation, "review-appendix.md"),
    );
    assert.deepEqual(
      await validateExistingSkillDirectory(repoRoot, ".patchmill/skills"),
      buildRecommendedProjectSkillConfig(),
    );
    for (const requirement of INLINE_IMPLEMENTATION_RUNTIME_FILES) {
      if (requirement.executable) {
        const installed = join(
          repoRoot,
          ".patchmill/skills",
          requirement.skillName,
          requirement.path,
        );
        assert.equal(
          (await fs.stat(installed)).mode & 0o777,
          0o751,
          `source permissions survive staging: ${installed}`,
        );
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

for (const requirement of INLINE_IMPLEMENTATION_RUNTIME_FILES) {
  const relative = `${requirement.skillName}/${requirement.path}`;
  test(`missing native runtime files prevent publication: source ${relative}`, async () => {
    const { root, repoRoot, sourceRoots } = await fixture();
    try {
      await fs.rm(
        sourcePath(sourceRoots, requirement.skillName, requirement.path),
      );
      await assert.rejects(
        installProjectSkills({ repoRoot, sourceRoots }),
        (error: Error) => error.message.includes(relative),
      );
      await assertUnpublished(repoRoot);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test(`missing native runtime files prevent publication: staged ${relative}`, async () => {
    const { root, repoRoot, sourceRoots } = await fixture();
    try {
      await assert.rejects(
        installProjectSkills({
          repoRoot,
          sourceRoots,
          dependencies: {
            ...fs,
            cp: async (source, target, options) => {
              await fs.cp(source, target, options);
              if (String(source).endsWith(`/${requirement.skillName}`)) {
                await fs.rm(join(String(target), requirement.path));
              }
            },
          },
        }),
        (error: Error) => error.message.includes(relative),
      );
      await assertUnpublished(repoRoot);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test(`path mode rejects missing native runtime file: ${relative}`, async () => {
    const { root, repoRoot, sourceRoots } = await fixture();
    try {
      await installProjectSkills({
        repoRoot,
        sourceRoots,
        skillDir: "custom/skills",
      });
      assert.deepEqual(
        await validateExistingSkillDirectory(repoRoot, "custom/skills"),
        buildRecommendedProjectSkillConfig("custom/skills"),
      );
      await fs.rm(join(repoRoot, "custom/skills", relative));
      await assert.rejects(
        validateExistingSkillDirectory(repoRoot, "custom/skills"),
        (error: Error) => error.message.includes(`custom/skills/${relative}`),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  if (!requirement.executable) continue;
  for (const location of ["source", "staged", "path"] as const) {
    test(`native helpers must remain executable: ${location} ${relative}`, async () => {
      const { root, repoRoot, sourceRoots } = await fixture();
      try {
        if (location === "path") {
          await installProjectSkills({
            repoRoot,
            sourceRoots,
            skillDir: "custom/skills",
          });
          await fs.chmod(join(repoRoot, "custom/skills", relative), 0o644);
          await assert.rejects(
            validateExistingSkillDirectory(repoRoot, "custom/skills"),
            (error: Error) => error.message.includes(relative),
          );
        } else {
          if (location === "source") {
            await fs.chmod(
              sourcePath(sourceRoots, requirement.skillName, requirement.path),
              0o644,
            );
          }
          await assert.rejects(
            installProjectSkills({
              repoRoot,
              sourceRoots,
              dependencies: {
                ...fs,
                cp: async (source, target, options) => {
                  await fs.cp(source, target, options);
                  if (
                    location === "staged" &&
                    String(source).endsWith(`/${requirement.skillName}`)
                  ) {
                    await fs.chmod(
                      join(String(target), requirement.path),
                      0o644,
                    );
                  }
                },
              },
            }),
            (error: Error) => error.message.includes(relative),
          );
          await assertUnpublished(repoRoot);
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  }
}
