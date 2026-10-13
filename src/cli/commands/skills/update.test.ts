import {
  writeFrontendWorkflowFiles,
  frontendWorkflowFiles,
} from "../../../../test-support/frontend-workflow-files.ts";
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
  buildSkillPackMetadata,
  type SkillPackMetadataFile,
  type SkillPackSkill,
} from "../../../workflow/skill-pack.ts";
import {
  defaultSkillSourceRoots,
  type SkillInstallerDependencies,
} from "../init/skill-installer.ts";
import { INLINE_IMPLEMENTATION_RUNTIME_FILES } from "../../../workflow/skill-runtime-requirements.ts";
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

const oldPatchmillPlanning = `---
name: patchmill-planning
description: Old Patchmill planning wrapper.
---
# Old Patchmill planning
`;

const newPatchmillPlanning = `---
name: patchmill-planning
description: New Patchmill planning wrapper.
---
# New Patchmill planning
`;

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
  if (name === "patchmill-planning") await writeFrontendWorkflowFiles(root);
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
  version = "2026.04",
): SkillPackMetadataFile {
  return {
    pack: {
      name: "patchmill-recommended",
      version,
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

// Metadata and frontend migration boundaries use small custom packs to isolate update decisions.
const planningPackSkills: SkillPackSkill[] = [
  { name: "frontend-design", source: "patchmill" },
  { name: "patchmill-planning", source: "patchmill" },
];
const frontendNotice = {
  version: "2026.10.2",
  message:
    "The recommended pack adds conditional frontend design and independent frontend review.\nNo patchmill.config.json change is required.",
};

test("update refreshes provenance without changed hashes and rejects malformed metadata before mutation", async () => {
  const repoRoot = await tempRoot("patchmill-provenance-");
  const source = await tempRoot("patchmill-provenance-source-");
  const oldSkill: SkillPackSkill = {
    name: "fixture-review",
    source: "patchmill",
    upstreamSources: [
      {
        repository: "example/rules",
        commit: "old-pin",
        files: [{ sourcePath: "command.md", targetPath: "SKILL.md" }],
        license: { name: "MIT", sourcePath: "README.md#license" },
      },
    ],
  };
  const newSkill: SkillPackSkill = {
    ...oldSkill,
    upstreamSources: [{ ...oldSkill.upstreamSources![0]!, commit: "new-pin" }],
  };
  await writeSkill(source, "fixture-review", { "SKILL.md": newWritingPlans });
  const path = ".patchmill/skills/fixture-review/SKILL.md";
  await writeFileEnsuringParent(join(repoRoot, path), newWritingPlans);
  const original = buildSkillPackMetadata(
    [{ path, sha256: hashText(newWritingPlans) }],
    { skills: [oldSkill] },
  );
  await writeMetadata(repoRoot, original);
  const options = {
    repoRoot,
    sourceRoots: { ...defaultSkillSourceRoots(), patchmillSkillsDir: source },
    packSkills: [newSkill],
  };
  const result = await updateProjectSkills(options);
  assert.equal(result.status, "updated");
  if (result.status === "updated") assert.equal(result.updatedFiles, 0);
  assert.equal((await updateProjectSkills(options)).status, "up-to-date");
  const metadataPath = join(
    repoRoot,
    ".patchmill/skills",
    SKILL_PACK_METADATA_FILE,
  );
  const valid = JSON.parse(await readFile(metadataPath, "utf8"));
  assert.equal(valid.skills[0].upstreamSources[0].commit, "new-pin");
  const skill = valid.skills[0];
  const upstream = skill.upstreamSources[0];
  const badSkills = [
    null,
    {},
    [null],
    [{ ...skill, name: "" }],
    [{ ...skill, source: "unknown" }],
    [{ ...skill, source: ["patchmill"] }],
    [{ ...skill, name: undefined }],
    [{ ...skill, source: undefined }],
    [{ ...skill, requiredFiles: undefined }],
    [{ ...skill, requiredFiles: [] }],
    [{ ...skill, requiredFiles: "not-array" }],
    [{ ...skill, upstreamSources: {} }],
    ...["repository", "commit"].map((key) => [
      { ...skill, upstreamSources: [{ ...upstream, [key]: "" }] },
    ]),
    [
      {
        ...skill,
        upstreamSources: [
          { ...upstream, files: [{ sourcePath: "", installedPath: path }] },
        ],
      },
    ],
    [
      {
        ...skill,
        upstreamSources: [
          { ...upstream, license: { name: "", sourcePath: "LICENSE" } },
        ],
      },
    ],
    [
      {
        ...skill,
        upstreamSources: [
          { ...upstream, license: { name: "MIT", sourcePath: "" } },
        ],
      },
    ],
  ];
  for (const unsafe of [
    "outside/file",
    ".patchmill/skills/../escape",
    ".patchmill/skills//a",
    ".patchmill/skills/./a",
    ".patchmill/skills/a\\b",
    ".patchmill/skills/a\u0000b",
  ]) {
    badSkills.push(
      [{ ...skill, requiredFiles: [unsafe] }],
      [
        {
          ...skill,
          upstreamSources: [
            {
              ...upstream,
              files: [{ sourcePath: "command.md", installedPath: unsafe }],
            },
          ],
        },
      ],
      [
        {
          ...skill,
          upstreamSources: [
            {
              ...upstream,
              license: {
                name: "MIT",
                sourcePath: "LICENSE",
                installedPath: unsafe,
              },
            },
          ],
        },
      ],
    );
  }
  for (const skills of badSkills) {
    const text = JSON.stringify({ ...valid, skills });
    await writeFile(metadataPath, text);
    await assert.rejects(updateProjectSkills(options), /No Patchmill-managed/u);
    assert.equal(await readFile(metadataPath, "utf8"), text);
    assert.equal(await readFile(join(repoRoot, path), "utf8"), newWritingPlans);
  }
});

test("missing frontend source license rejects update without mutation", async () => {
  const repoRoot = await tempRoot("patchmill-update-sidecar-");
  const source = await tempRoot("patchmill-update-sidecar-source-");
  await writeSkill(source, "frontend-design", { "SKILL.md": newWritingPlans });
  const path = ".patchmill/skills/frontend-design/SKILL.md";
  await writeFileEnsuringParent(join(repoRoot, path), oldWritingPlans);
  await writeMetadata(
    repoRoot,
    oldMetadata([{ path, sha256: hashText(oldWritingPlans) }]),
  );
  const metadataPath = join(
    repoRoot,
    ".patchmill/skills",
    SKILL_PACK_METADATA_FILE,
  );
  const before = await readFile(metadataPath);
  await assert.rejects(
    updateProjectSkills({
      repoRoot,
      sourceRoots: { ...defaultSkillSourceRoots(), patchmillSkillsDir: source },
      packSkills: [{ name: "frontend-design", source: "patchmill" }],
    }),
    /Missing required skill file: frontend-design\/LICENSE.txt/u,
  );
  assert.deepEqual(await readFile(metadataPath), before);
  assert.equal(await readFile(join(repoRoot, path), "utf8"), oldWritingPlans);
});

test("2026.10.1 frontend migration preserves custom config and rejects customization and new-file collisions", async () => {
  for (const scenario of ["clean", "customized", "collision"] as const) {
    const repoRoot = await tempRoot("patchmill-frontend-migration-");
    const configPath = join(repoRoot, "patchmill.config.json");
    const config = JSON.stringify({
      skills: { planning: "global-planning", implementation: "custom/inline" },
    });
    await writeFile(configPath, config);
    const oldPath = ".patchmill/skills/writing-plans/SKILL.md";
    await writeFileEnsuringParent(join(repoRoot, oldPath), oldWritingPlans);
    const files = [{ path: oldPath, sha256: hashText(oldWritingPlans) }];
    if (scenario === "customized") {
      const path = ".patchmill/skills/frontend-design/SKILL.md";
      files.push({ path, sha256: hashText(oldWritingPlans) });
      await writeFileEnsuringParent(join(repoRoot, path), "local edits");
    }
    if (scenario === "collision")
      await writeFileEnsuringParent(
        join(repoRoot, ".patchmill/skills/frontend-design/LICENSE.txt"),
        "local license",
      );
    await writeMetadata(repoRoot, oldMetadata(files, "2026.10.1"));
    const metadataPath = join(
      repoRoot,
      ".patchmill/skills",
      SKILL_PACK_METADATA_FILE,
    );
    const before = await readFile(metadataPath);
    const options = {
      repoRoot,
      packSkills: [
        { name: "frontend-design", source: "patchmill" },
      ] as SkillPackSkill[],
    };
    if (scenario === "clean") {
      const result = await updateProjectSkills(options);
      assert.equal(result.status, "updated");
      assert.deepEqual(result.notices, [frontendNotice]);
    } else {
      await assert.rejects(
        updateProjectSkills(options),
        scenario === "customized"
          ? /Refusing to update customized project-local skills/u
          : /Refusing to overwrite unmanaged project-local skill files/u,
      );
      assert.deepEqual(await readFile(metadataPath), before);
      assert.equal(
        await readFile(join(repoRoot, oldPath), "utf8"),
        oldWritingPlans,
      );
    }
    assert.equal(await readFile(configPath, "utf8"), config);
  }
});

// Existing update, customization, and runtime-file regressions remain together below.
test("updateProjectSkills updates clean managed project-local skills", async () => {
  const repoRoot = await tempRoot("patchmill-skills-update-repo-");
  const patchmillSource = await tempRoot("patchmill-skills-update-patchmill-");
  const superpowersSource = await tempRoot(
    "patchmill-skills-update-superpowers-",
  );
  await writeSkill(patchmillSource, "patchmill-planning", {
    "SKILL.md": newPatchmillPlanning,
    "policy.md": "new wrapper policy\n",
  });
  await chmod(join(patchmillSource, "patchmill-planning", "policy.md"), 0o400);

  await writeFileEnsuringParent(
    join(repoRoot, ".patchmill", "skills", "patchmill-planning", "SKILL.md"),
    oldPatchmillPlanning,
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
        path: ".patchmill/skills/patchmill-planning/SKILL.md",
        sha256: hashText(oldPatchmillPlanning),
      },
    ]),
  );

  const result = await updateProjectSkills({
    repoRoot,
    sourceRoots: {
      patchmillSkillsDir: patchmillSource,
      superpowersSkillsDir: superpowersSource,
      simpleEnglishSkillsDir: await tempRoot(
        "patchmill-skills-simple-english-",
      ),
    },
    packSkills: planningPackSkills,
    installedAt: "2026-06-27T00:00:00.000Z",
    dependencies,
  });

  assert.deepEqual(result, {
    status: "updated",
    fromVersion: "2026.04",
    toVersion: PATCHMILL_RECOMMENDED_SKILL_PACK.version,
    updatedFiles: 4,
    removedFiles: 1,
    notices: [
      {
        version: "2026.07.1",
        message:
          "Patchmill's recommended planning skill changed to patchmill-planning.\n" +
          "To opt in, update patchmill.config.json:\n" +
          '  "planning": ".patchmill/skills/patchmill-planning"',
      },
      {
        version: "2026.09.1",
        message:
          "Fresh Run-once review gates now use planning pull requests whose verified merge advances the Issue run. Legacy set-spec, set-plan, and --plan-only controls remain available but are deprecated.",
      },
      {
        version: "2026.09.2",
        message:
          "Patchmill's recommended skill pack now includes simple-english. The patchmill-planning wrapper requires it as a sibling skill and applies its plain-language rules when writing specs and plans.",
      },
      {
        version: "2026.10.1",
        message:
          "The managed implementation wrappers are retired: subagent-dev-with-validation-and-pr-checks, subagent-dev-with-codex-and-thermo-reviews, and single-subagent-dev-with-codex-and-thermo-reviews.\n" +
          "Use the inline workflow. Explicitly update patchmill.config.json:\n" +
          '  "implementation": ".patchmill/skills/inline-dev-with-validation-and-pr-checks"\n' +
          "Skills updates do not rewrite config. Customized files require an explicit operator decision before replacement.",
      },
      frontendNotice,
    ],
  });
  assert.equal(
    await readFile(
      join(repoRoot, ".patchmill", "skills", "patchmill-planning", "SKILL.md"),
      "utf8",
    ),
    newPatchmillPlanning,
  );
  const updatedReviewerPromptPath = join(
    repoRoot,
    ".patchmill",
    "skills",
    "patchmill-planning",
    "policy.md",
  );
  assert.equal(
    await readFile(updatedReviewerPromptPath, "utf8"),
    "new wrapper policy\n",
  );
  assert.notEqual((await stat(updatedReviewerPromptPath)).mode & 0o200, 0);
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
    ...(
      ["frontend-design/LICENSE.txt", "frontend-design/SKILL.md"] as const
    ).map((path) => ({
      path: `.patchmill/skills/${path}`,
      sha256: hashText(frontendWorkflowFiles[path]),
    })),
    {
      path: ".patchmill/skills/patchmill-planning/SKILL.md",
      sha256: hashText(newPatchmillPlanning),
    },
    {
      path: ".patchmill/skills/patchmill-planning/policy.md",
      sha256: hashText("new wrapper policy\n"),
    },
  ]);
});

test("updateProjectSkills reports only the planning-pull-request notice from 2026.07.2", async () => {
  const repoRoot = await tempRoot("patchmill-skills-boundary-repo-");
  const patchmillSource = await tempRoot(
    "patchmill-skills-boundary-patchmill-",
  );
  const superpowersSource = await tempRoot(
    "patchmill-skills-boundary-superpowers-",
  );
  await writeSkill(patchmillSource, "patchmill-planning", {
    "SKILL.md": newPatchmillPlanning,
  });
  await writeFileEnsuringParent(
    join(repoRoot, ".patchmill", "skills", "patchmill-planning", "SKILL.md"),
    oldPatchmillPlanning,
  );
  await writeMetadata(
    repoRoot,
    oldMetadata(
      [
        {
          path: ".patchmill/skills/patchmill-planning/SKILL.md",
          sha256: hashText(oldPatchmillPlanning),
        },
      ],
      "2026.07.2",
    ),
  );

  const first = await updateProjectSkills({
    repoRoot,
    sourceRoots: {
      patchmillSkillsDir: patchmillSource,
      superpowersSkillsDir: superpowersSource,
      simpleEnglishSkillsDir: await tempRoot(
        "patchmill-skills-simple-english-",
      ),
    },
    packSkills: planningPackSkills,
    dependencies,
  });
  assert.deepEqual(first.notices, [
    {
      version: "2026.09.1",
      message:
        "Fresh Run-once review gates now use planning pull requests whose verified merge advances the Issue run. Legacy set-spec, set-plan, and --plan-only controls remain available but are deprecated.",
    },
    {
      version: "2026.09.2",
      message:
        "Patchmill's recommended skill pack now includes simple-english. The patchmill-planning wrapper requires it as a sibling skill and applies its plain-language rules when writing specs and plans.",
    },
    {
      version: "2026.10.1",
      message:
        "The managed implementation wrappers are retired: subagent-dev-with-validation-and-pr-checks, subagent-dev-with-codex-and-thermo-reviews, and single-subagent-dev-with-codex-and-thermo-reviews.\n" +
        "Use the inline workflow. Explicitly update patchmill.config.json:\n" +
        '  "implementation": ".patchmill/skills/inline-dev-with-validation-and-pr-checks"\n' +
        "Skills updates do not rewrite config. Customized files require an explicit operator decision before replacement.",
    },
    frontendNotice,
  ]);

  const second = await updateProjectSkills({
    repoRoot,
    sourceRoots: {
      patchmillSkillsDir: patchmillSource,
      superpowersSkillsDir: superpowersSource,
      simpleEnglishSkillsDir: await tempRoot(
        "patchmill-skills-simple-english-",
      ),
    },
    packSkills: planningPackSkills,
    dependencies,
  });
  assert.deepEqual(second, {
    status: "up-to-date",
    version: PATCHMILL_RECOMMENDED_SKILL_PACK.version,
  });
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
      additionalSources: PATCHMILL_RECOMMENDED_SKILL_PACK.additionalSources,
    },
    installedAt: "2026-06-01T00:00:00.000Z",
    skillDir: ".patchmill/skills",
    metadataFile: SKILL_PACK_METADATA_FILE,
    skills: [
      {
        name: "writing-plans",
        source: "superpowers",
        requiredFiles: [".patchmill/skills/writing-plans/SKILL.md"],
      },
    ],
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
      simpleEnglishSkillsDir: await tempRoot(
        "patchmill-skills-simple-english-",
      ),
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
    "plan-document-reviewer-prompt.md": "new reviewer prompt\n",
  });
  await writeFileEnsuringParent(
    join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
    "local edit\n",
  );
  await writeFileEnsuringParent(
    join(
      repoRoot,
      ".patchmill",
      "skills",
      "writing-plans",
      "plan-document-reviewer-prompt.md",
    ),
    "local reviewer edit\n",
  );
  await writeMetadata(
    repoRoot,
    oldMetadata([
      {
        path: ".patchmill/skills/writing-plans/SKILL.md",
        sha256: hashText(oldWritingPlans),
      },
      {
        path: ".patchmill/skills/writing-plans/plan-document-reviewer-prompt.md",
        sha256: hashText("old reviewer prompt\n"),
      },
    ]),
  );

  await assert.rejects(
    updateProjectSkills({
      repoRoot,
      sourceRoots: {
        patchmillSkillsDir: await tempRoot("patchmill-skills-dirty-patchmill-"),
        superpowersSkillsDir: superpowersSource,
        simpleEnglishSkillsDir: await tempRoot(
          "patchmill-skills-simple-english-",
        ),
      },
      packSkills: [{ name: "writing-plans", source: "superpowers" }],
      dependencies,
    }),
    /Refusing to update customized project-local skills:\n- \.patchmill\/skills\/writing-plans\/SKILL\.md\n- \.patchmill\/skills\/writing-plans\/plan-document-reviewer-prompt\.md/u,
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
        simpleEnglishSkillsDir: await tempRoot(
          "patchmill-skills-simple-english-",
        ),
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
      pack: {
        name: "patchmill-recommended",
        version: "",
        source: {
          type: "github-release",
          repository: "",
          tag: "v5.0.7",
          tarballUrl:
            "https://github.com/obra/superpowers/archive/refs/tags/v5.0.7.tar.gz",
        },
      },
      skillDir: ".patchmill/skills",
      metadataFile: SKILL_PACK_METADATA_FILE,
      files: [
        null,
        { path: ".patchmill/skills/writing-plans/SKILL.md", sha256: "notsha" },
      ],
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
        simpleEnglishSkillsDir: await tempRoot(
          "patchmill-skills-simple-english-",
        ),
      },
      packSkills: [{ name: "writing-plans", source: "superpowers" }],
      dependencies,
    }),
    /Refusing to overwrite unmanaged project-local skill files:\n- \.patchmill\/skills\/writing-plans\/new-file\.md/u,
  );
});

// Catches removal/copy before runtime validation and silent config rewriting.
test("migration preserves customized and unmanaged skills", async () => {
  const repoRoot = await tempRoot("patchmill-migration-");
  try {
    const oldPath =
      ".patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md";
    const configPath = join(repoRoot, "patchmill.config.json");
    const configBytes = Buffer.from(
      '{ "skills": { "implementation": "' + oldPath + '" } }\n',
    );
    const customPath = join(repoRoot, ".patchmill/skills/landing/SKILL.md");
    const customBytes = Buffer.from("local landing: preserve exactly\n");
    await writeFileEnsuringParent(
      join(repoRoot, oldPath),
      "managed original\n",
    );
    await writeFileEnsuringParent(customPath, customBytes.toString());
    await writeFile(configPath, configBytes);
    await writeMetadata(
      repoRoot,
      oldMetadata([{ path: oldPath, sha256: hashText("managed original\n") }]),
    );
    await writeFile(join(repoRoot, oldPath), "customized old skill\n");
    await assert.rejects(
      updateProjectSkills({ repoRoot }),
      /Refusing to update customized/,
    );
    assert.equal(
      await readFile(join(repoRoot, oldPath), "utf8"),
      "customized old skill\n",
    );
    assert.deepEqual(await readFile(configPath), configBytes);
    assert.deepEqual(await readFile(customPath), customBytes);

    await writeFile(join(repoRoot, oldPath), "managed original\n");
    const result = await updateProjectSkills({ repoRoot });
    assert.equal(result.status, "updated");
    assert.deepEqual(await readFile(configPath), configBytes);
    assert.deepEqual(await readFile(customPath), customBytes);
    await assert.rejects(access(join(repoRoot, oldPath)));
    if (result.status !== "updated") return;
    const notice = result.notices.find((item) => item.version === "2026.10.1");
    assert.match(
      notice?.message ?? "",
      /inline-dev-with-validation-and-pr-checks/,
    );
    for (const name of [
      "subagent-dev-with-validation-and-pr-checks",
      "subagent-dev-with-codex-and-thermo-reviews",
      "single-subagent-dev-with-codex-and-thermo-reviews",
    ]) {
      assert.ok(notice?.message.includes(name));
    }
    assert.equal(
      result.notices.some((item) => item.version === "2026.07.2"),
      false,
      "do not recommend a removed workflow alongside the migration",
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

for (const requirement of INLINE_IMPLEMENTATION_RUNTIME_FILES) {
  for (const failure of requirement.executable
    ? ["missing", "non-executable"]
    : ["missing"]) {
    test(`update validates native source before removing managed files: ${failure} ${requirement.skillName}/${requirement.path}`, async () => {
      const repoRoot = await tempRoot("patchmill-update-runtime-");
      try {
        const roots = defaultSkillSourceRoots();
        const sourceRoots = { ...roots };
        const key =
          requirement.skillName === "inline-dev-with-validation-and-pr-checks"
            ? "patchmillSkillsDir"
            : "superpowersSkillsDir";
        sourceRoots[key] = join(repoRoot, "source");
        await cp(roots[key], sourceRoots[key], { recursive: true });
        const broken = join(
          sourceRoots[key],
          requirement.skillName,
          requirement.path,
        );
        if (failure === "missing") await rm(broken);
        else await chmod(broken, 0o644);
        const oldPath = ".patchmill/skills/obsolete-skill/SKILL.md";
        await writeFileEnsuringParent(
          join(repoRoot, oldPath),
          oldObsoleteSkill,
        );
        const original = oldMetadata([
          { path: oldPath, sha256: hashText(oldObsoleteSkill) },
        ]);
        await writeMetadata(repoRoot, original);
        const metadataPath = join(
          repoRoot,
          ".patchmill/skills",
          SKILL_PACK_METADATA_FILE,
        );
        const metadataBytes = await readFile(metadataPath);
        await assert.rejects(
          updateProjectSkills({ repoRoot, sourceRoots }),
          (error: Error) =>
            error.message.includes(
              `${requirement.skillName}/${requirement.path}`,
            ),
        );
        assert.equal(
          await readFile(join(repoRoot, oldPath), "utf8"),
          oldObsoleteSkill,
        );
        assert.deepEqual(await readFile(metadataPath), metadataBytes);
        await assert.rejects(
          access(
            join(
              repoRoot,
              ".patchmill/skills/inline-dev-with-validation-and-pr-checks",
            ),
          ),
        );
      } finally {
        await rm(repoRoot, { recursive: true, force: true });
      }
    });
  }
}
