import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SkillPackMetadataFile } from "../../../workflow/skill-pack.ts";
import {
  defaultSkillSourceRoots,
  installProjectSkills,
} from "./skill-installer.ts";

const tempRoot = (prefix: string) => fs.mkdtemp(join(tmpdir(), prefix));

test("frontend files and custom metadata paths install together; missing staged license never publishes", async () => {
  for (const skillDir of [".patchmill/skills", "custom/skills"]) {
    const repoRoot = await tempRoot("patchmill-frontend-install-");
    const result = await installProjectSkills({ repoRoot, skillDir });
    const metadata = JSON.parse(
      await fs.readFile(result.metadataPath, "utf8"),
    ) as SkillPackMetadataFile;
    for (const path of [
      "frontend-design/SKILL.md",
      "frontend-design/LICENSE.txt",
      "patchmill-frontend-review/SKILL.md",
      "patchmill-frontend-review/LICENSE",
      "patchmill-frontend-review/references/upstream-web-design-guidelines.md",
      "patchmill-frontend-review/references/web-interface-guidelines.md",
    ])
      assert.notEqual(
        (await fs.readFile(join(repoRoot, skillDir, path))).length,
        0,
      );
    assert.ok(metadata.skills);
    assert.equal(
      metadata.skills.every((skill) =>
        skill.requiredFiles.every((path) => path.startsWith(`${skillDir}/`)),
      ),
      true,
    );
  }
  const repoRoot = await tempRoot("patchmill-frontend-staged-");
  await assert.rejects(
    installProjectSkills({
      repoRoot,
      dependencies: {
        ...fs,
        async cp(source, target, options) {
          await fs.cp(source, target, options);
          if (String(target).endsWith("frontend-design"))
            await fs.rm(join(String(target), "LICENSE.txt"));
        },
      },
    }),
    /Missing required skill file: .*frontend-design.*LICENSE.txt/u,
  );
  await assert.rejects(fs.access(join(repoRoot, ".patchmill/skills")));
  assert.deepEqual(await fs.readdir(join(repoRoot, ".patchmill")), []);
});

test("missing frontend source sidecars fail preflight without creating a pack", async () => {
  for (const [name, omitted] of [
    ["frontend-design", "LICENSE.txt"],
    ["patchmill-frontend-review", "LICENSE"],
    ["patchmill-frontend-review", "references/web-interface-guidelines.md"],
  ]) {
    const repoRoot = await tempRoot("patchmill-frontend-preflight-");
    const source = await tempRoot("patchmill-frontend-source-");
    await fs.cp(defaultSkillSourceRoots().patchmillSkillsDir, source, {
      recursive: true,
    });
    await fs.rm(join(source, name, omitted));
    await assert.rejects(
      installProjectSkills({
        repoRoot,
        sourceRoots: {
          ...defaultSkillSourceRoots(),
          patchmillSkillsDir: source,
        },
      }),
      (error: unknown) =>
        error instanceof Error && error.message.includes(omitted),
    );
    await assert.rejects(fs.access(join(repoRoot, ".patchmill/skills")));
  }
});
