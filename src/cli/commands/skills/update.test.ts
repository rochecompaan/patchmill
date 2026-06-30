import assert from "node:assert/strict";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  hashText,
  type SkillPackMetadataFile,
} from "../../../workflow/skill-pack.ts";
import type { SkillInstallerDependencies } from "../init/skill-installer.ts";
import { updateProjectSkills } from "./update.ts";

const dependencies: SkillInstallerDependencies = {
  access,
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
};

const oldWritingPlans = `---
name: writing-plans
description: Old planning skill.
---
# Old planning
`;

const newWritingPlans = `---
name: writing-plans
description: New planning skill.
---
# New planning
`;

const oldObsoleteSkill = `---
name: obsolete-skill
description: Removed from the pack.
---
# Obsolete
`;

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeFileEnsuringParent(path: string, content: string) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
}

async function writeSkill(
  root: string,
  name: string,
  files: Record<string, string>,
) {
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFileEnsuringParent(join(root, name, relativePath), content);
  }
}

async function writeMetadata(
  repoRoot: string,
  metadata: SkillPackMetadataFile,
) {
  await writeFileEnsuringParent(
    join(repoRoot, ".patchmill", "skills", SKILL_PACK_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
}

function oldMetadata(
  files: Array<{ path: string; sha256: string }>,
): SkillPackMetadataFile {
  return {
    pack: {
      name: "patchmill-recommended",
      version: "2026.04",
      source: {
        type: "github-release",
        repository: "obra/superpowers",
        tag: "v5.0.7",
        tarballUrl:
          "https://github.com/obra/superpowers/archive/refs/tags/v5.0.7.tar.gz",
      },
    },
    installedAt: "2026-05-01T00:00:00.000Z",
    skillDir: ".patchmill/skills",
    metadataFile: SKILL_PACK_METADATA_FILE,
    files,
  };
}

test("updateProjectSkills updates clean managed project-local skills", async () => {
  const repoRoot = await tempRoot("patchmill-skills-update-repo-");
  const superpowersSource = await tempRoot(
    "patchmill-skills-update-superpowers-",
  );
  await writeSkill(superpowersSource, "writing-plans", {
    "SKILL.md": newWritingPlans,
    "notes.md": "new notes\n",
  });
  await chmod(join(superpowersSource, "writing-plans", "notes.md"), 0o400);

  await writeFileEnsuringParent(
    join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
    oldWritingPlans,
  );
  await writeFileEnsuringParent(
    join(repoRoot, ".patchmill", "skills", "obsolete-skill", "SKILL.md"),
    oldObsoleteSkill,
  );
  await writeMetadata(
    repoRoot,
    oldMetadata([
      {
        path: ".patchmill/skills/obsolete-skill/SKILL.md",
        sha256: hashText(oldObsoleteSkill),
      },
      {
        path: ".patchmill/skills/writing-plans/SKILL.md",
        sha256: hashText(oldWritingPlans),
      },
    ]),
  );

  const result = await updateProjectSkills({
    repoRoot,
    sourceRoots: {
      patchmillSkillsDir: await tempRoot("patchmill-skills-update-patchmill-"),
      superpowersSkillsDir: superpowersSource,
    },
    packSkills: [{ name: "writing-plans", source: "superpowers" }],
    installedAt: "2026-06-27T00:00:00.000Z",
    dependencies,
  });

  assert.deepEqual(result, {
    status: "updated",
    fromVersion: "2026.04",
    toVersion: PATCHMILL_RECOMMENDED_SKILL_PACK.version,
    updatedFiles: 2,
    removedFiles: 1,
  });
  assert.equal(
    await readFile(
      join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
      "utf8",
    ),
    newWritingPlans,
  );
  const updatedNotesPath = join(
    repoRoot,
    ".patchmill",
    "skills",
    "writing-plans",
    "notes.md",
  );
  assert.equal(await readFile(updatedNotesPath, "utf8"), "new notes\n");
  assert.notEqual((await stat(updatedNotesPath)).mode & 0o200, 0);
  await assert.rejects(
    access(
      join(repoRoot, ".patchmill", "skills", "obsolete-skill", "SKILL.md"),
    ),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "ENOENT",
  );

  const metadata = JSON.parse(
    await readFile(
      join(repoRoot, ".patchmill", "skills", SKILL_PACK_METADATA_FILE),
      "utf8",
    ),
  ) as SkillPackMetadataFile;
  assert.equal(metadata.pack.version, PATCHMILL_RECOMMENDED_SKILL_PACK.version);
  assert.equal(metadata.installedAt, "2026-06-27T00:00:00.000Z");
  assert.deepEqual(metadata.files, [
    {
      path: ".patchmill/skills/writing-plans/SKILL.md",
      sha256: hashText(newWritingPlans),
    },
    {
      path: ".patchmill/skills/writing-plans/notes.md",
      sha256: hashText("new notes\n"),
    },
  ]);
});

test("updateProjectSkills reports already current packs", async () => {
  const repoRoot = await tempRoot("patchmill-skills-current-repo-");
  const superpowersSource = await tempRoot(
    "patchmill-skills-current-superpowers-",
  );
  await writeSkill(superpowersSource, "writing-plans", {
    "SKILL.md": newWritingPlans,
  });
  await writeFileEnsuringParent(
    join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
    newWritingPlans,
  );
  await writeMetadata(repoRoot, {
    pack: {
      name: PATCHMILL_RECOMMENDED_SKILL_PACK.name,
      version: PATCHMILL_RECOMMENDED_SKILL_PACK.version,
      source: PATCHMILL_RECOMMENDED_SKILL_PACK.source,
    },
    installedAt: "2026-06-01T00:00:00.000Z",
    skillDir: ".patchmill/skills",
    metadataFile: SKILL_PACK_METADATA_FILE,
    files: [
      {
        path: ".patchmill/skills/writing-plans/SKILL.md",
        sha256: hashText(newWritingPlans),
      },
    ],
  });

  const result = await updateProjectSkills({
    repoRoot,
    sourceRoots: {
      patchmillSkillsDir: await tempRoot("patchmill-skills-current-patchmill-"),
      superpowersSkillsDir: superpowersSource,
    },
    packSkills: [{ name: "writing-plans", source: "superpowers" }],
    dependencies,
  });

  assert.deepEqual(result, {
    status: "up-to-date",
    version: PATCHMILL_RECOMMENDED_SKILL_PACK.version,
  });
});

test("updateProjectSkills aborts when managed files changed locally", async () => {
  const repoRoot = await tempRoot("patchmill-skills-dirty-repo-");
  const superpowersSource = await tempRoot(
    "patchmill-skills-dirty-superpowers-",
  );
  await writeSkill(superpowersSource, "writing-plans", {
    "SKILL.md": newWritingPlans,
  });
  await writeFileEnsuringParent(
    join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
    "local edit\n",
  );
  await writeMetadata(
    repoRoot,
    oldMetadata([
      {
        path: ".patchmill/skills/writing-plans/SKILL.md",
        sha256: hashText(oldWritingPlans),
      },
    ]),
  );

  await assert.rejects(
    updateProjectSkills({
      repoRoot,
      sourceRoots: {
        patchmillSkillsDir: await tempRoot("patchmill-skills-dirty-patchmill-"),
        superpowersSkillsDir: superpowersSource,
      },
      packSkills: [{ name: "writing-plans", source: "superpowers" }],
      dependencies,
    }),
    /Refusing to update customized project-local skills:\n- \.patchmill\/skills\/writing-plans\/SKILL\.md/u,
  );
  assert.equal(
    await readFile(
      join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
      "utf8",
    ),
    "local edit\n",
  );
});

test("updateProjectSkills aborts when managed files are missing", async () => {
  const repoRoot = await tempRoot("patchmill-skills-missing-repo-");
  const superpowersSource = await tempRoot(
    "patchmill-skills-missing-superpowers-",
  );
  await writeSkill(superpowersSource, "writing-plans", {
    "SKILL.md": newWritingPlans,
  });
  await writeMetadata(
    repoRoot,
    oldMetadata([
      {
        path: ".patchmill/skills/writing-plans/SKILL.md",
        sha256: hashText(oldWritingPlans),
      },
    ]),
  );

  await assert.rejects(
    updateProjectSkills({
      repoRoot,
      sourceRoots: {
        patchmillSkillsDir: await tempRoot(
          "patchmill-skills-missing-patchmill-",
        ),
        superpowersSkillsDir: superpowersSource,
      },
      packSkills: [{ name: "writing-plans", source: "superpowers" }],
      dependencies,
    }),
    /Refusing to update customized project-local skills:\n- \.patchmill\/skills\/writing-plans\/SKILL\.md \(missing\)/u,
  );
});

test("updateProjectSkills requires Patchmill-managed project-local metadata", async () => {
  const repoRoot = await tempRoot("patchmill-skills-no-metadata-repo-");

  await assert.rejects(
    updateProjectSkills({ repoRoot, dependencies }),
    /No Patchmill-managed project-local skill pack found\. Run `patchmill init` first,\nor reinstall project-local skills\./u,
  );
});

test("updateProjectSkills rejects malformed metadata shapes", async () => {
  const repoRoot = await tempRoot("patchmill-skills-malformed-metadata-repo-");
  await writeFileEnsuringParent(
    join(repoRoot, ".patchmill", "skills", SKILL_PACK_METADATA_FILE),
    JSON.stringify({
      pack: { name: "patchmill-recommended", version: "2026.04" },
      skillDir: ".patchmill/skills",
      metadataFile: SKILL_PACK_METADATA_FILE,
      files: [null, { path: ".patchmill/skills/writing-plans/SKILL.md" }],
    }),
  );

  await assert.rejects(
    updateProjectSkills({ repoRoot, dependencies }),
    /No Patchmill-managed project-local skill pack found\. Run `patchmill init` first,\nor reinstall project-local skills\./u,
  );
});

test("updateProjectSkills rejects metadata paths outside project-local skills", async () => {
  for (const unsafePath of [
    ".patchmill/skills/../outside.md",
    ".patchmill/skills/writing-plans\\..\\..\\outside.md",
  ]) {
    const repoRoot = await tempRoot("patchmill-skills-unsafe-metadata-repo-");
    await writeMetadata(
      repoRoot,
      oldMetadata([
        {
          path: unsafePath,
          sha256: hashText(oldWritingPlans),
        },
      ]),
    );

    await assert.rejects(
      updateProjectSkills({ repoRoot, dependencies }),
      /No Patchmill-managed project-local skill pack found\. Run `patchmill init` first,\nor reinstall project-local skills\./u,
    );
  }
});

test("updateProjectSkills aborts when new bundled files would overwrite local files", async () => {
  const repoRoot = await tempRoot("patchmill-skills-collision-repo-");
  const superpowersSource = await tempRoot(
    "patchmill-skills-collision-superpowers-",
  );
  await writeSkill(superpowersSource, "writing-plans", {
    "SKILL.md": newWritingPlans,
    "new-file.md": "bundled file\n",
  });
  await writeFileEnsuringParent(
    join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
    oldWritingPlans,
  );
  await writeFileEnsuringParent(
    join(repoRoot, ".patchmill", "skills", "writing-plans", "new-file.md"),
    "local file\n",
  );
  await writeMetadata(
    repoRoot,
    oldMetadata([
      {
        path: ".patchmill/skills/writing-plans/SKILL.md",
        sha256: hashText(oldWritingPlans),
      },
    ]),
  );

  await assert.rejects(
    updateProjectSkills({
      repoRoot,
      sourceRoots: {
        patchmillSkillsDir: await tempRoot(
          "patchmill-skills-collision-patchmill-",
        ),
        superpowersSkillsDir: superpowersSource,
      },
      packSkills: [{ name: "writing-plans", source: "superpowers" }],
      dependencies,
    }),
    /Refusing to overwrite unmanaged project-local skill files:\n- \.patchmill\/skills\/writing-plans\/new-file\.md/u,
  );
});
